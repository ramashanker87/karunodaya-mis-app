import type { FastifyInstance } from 'fastify';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { Context } from '../types.js';
import { canChangeRecord, requireProgram, requireRole } from '../identity/access.js';
import { createEvent, getEvent, listEvents, replaceEvent } from './repo.js';
import { eventInputSchema, filterSchema, idSchema, programSchema } from '../../../shared/schema.js';

const pathSchema = z.object({ programId: programSchema, date: z.iso.date(), id: idSchema });

export function registerEventRoutes(app: FastifyInstance, { db, config }: Context) {
  app.get('/api/events', async (request) => {
    const filters = filterSchema.safeExtend({ programId: programSchema }).parse(request.query);
    requireProgram(request.access, filters.programId);
    const items = await listEvents(db, config, filters.programId, filters);
    return { items: request.access.role === 'facilitator' ? items.filter((item) => item.facilitatorId === request.access.staffId || item.createdBy === request.identity.sub) : items };
  });

  app.post('/api/events', async (request, reply) => {
    const input = eventInputSchema.parse(request.body);
    requireProgram(request.access, input.programId);
    if (request.access.role === 'facilitator' && input.facilitatorId !== request.access.staffId) return reply.code(403).send({ error: 'Cannot create another facilitator’s record' });
    return reply.code(201).send(await createEvent(db, config, input, request.identity.sub));
  });

  app.patch('/api/events/:programId/:date/:id', async (request, reply) => {
    const params = pathSchema.parse(request.params);
    const body = eventInputSchema.extend({ version: z.number().int().positive() }).parse(request.body);
    requireProgram(request.access, params.programId);
    const before = await getEvent(db, config, params.programId, params.date, params.id);
    if (!before || before.deletedAt) return reply.code(404).send({ error: 'Event not found' });
    if (!canChangeRecord(request.access, before.createdBy)) return reply.code(403).send({ error: 'Record access denied' });
    if (body.version !== before.version) return reply.code(409).send({ error: 'Record changed; reload before saving' });
    const { version: _version, ...input } = body;
    return replaceEvent(db, config, before, input, request.identity.sub, 'update');
  });

  app.delete('/api/events/:programId/:date/:id', async (request, reply) => {
    const params = pathSchema.parse(request.params);
    requireProgram(request.access, params.programId);
    const before = await getEvent(db, config, params.programId, params.date, params.id);
    if (!before || before.deletedAt) return reply.code(404).send({ error: 'Event not found' });
    if (!canChangeRecord(request.access, before.createdBy)) return reply.code(403).send({ error: 'Record access denied' });
    return replaceEvent(db, config, before, before, request.identity.sub, 'delete');
  });

  app.get('/api/admin/deleted', async (request) => {
    requireRole(request.access, 'admin');
    const query = z.object({ programId: programSchema }).parse(request.query);
    const audits = await db.send(new QueryCommand({ TableName: config.auditTable, IndexName: 'DeletedIndex', KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': `DELETED#${query.programId}` }, ScanIndexForward: false, Limit: 100 }));
    const uniqueAudits = [...new Map((audits.Items || []).map((audit) => [audit.entityId, audit])).values()];
    const items = await Promise.all(uniqueAudits.map(async (audit) => {
      const event = await getEvent(db, config, query.programId, audit.eventDate, audit.entityId);
      return event?.deletedAt ? { ...event, deletedBy: audit.actorSub } : null;
    }));
    return { items: items.filter(Boolean) };
  });

  app.post('/api/admin/restore/:programId/:date/:id', async (request, reply) => {
    requireRole(request.access, 'admin');
    const params = pathSchema.parse(request.params);
    const before = await getEvent(db, config, params.programId, params.date, params.id);
    if (!before?.deletedAt) return reply.code(404).send({ error: 'Deleted event not found' });
    return replaceEvent(db, config, before, before, request.identity.sub, 'restore');
  });

  app.get('/api/admin/history/:type/:id', async (request) => {
    requireRole(request.access, 'admin');
    const params = z.object({ type: z.enum(['event', 'student', 'task', 'user', 'file', 'directory']), id: idSchema }).parse(request.params);
    const result = await db.send(new QueryCommand({ TableName: config.auditTable, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `ENTITY#${params.type}#${params.id}` }, ScanIndexForward: false, Limit: 100 }));
    return { items: result.Items || [] };
  });
}
