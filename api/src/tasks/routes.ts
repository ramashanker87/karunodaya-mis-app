import type { FastifyInstance } from 'fastify';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { Context } from '../types.js';
import { newId, now, queryAll } from '../db.js';
import { requireProgram } from '../identity/access.js';
import { idSchema, programSchema, taskInputSchema } from '../../../shared/schema.js';

export function registerTaskRoutes(app: FastifyInstance, { db, config }: Context) {
  app.get('/api/tasks', async (request) => {
    const query = z.object({ programId: programSchema, assigneeId: idSchema.optional() }).parse(request.query);
    requireProgram(request.access, query.programId);
    const rows = query.assigneeId ? await queryAll(db, { TableName: config.operationsTable, IndexName: 'AssigneeDueIndex', KeyConditionExpression: 'GSI3PK = :pk', ExpressionAttributeValues: { ':pk': `ASSIGNEE#${query.assigneeId}` } }, 3000) : await queryAll(db, { TableName: config.operationsTable, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)', ExpressionAttributeValues: { ':pk': `PROGRAM#${query.programId}`, ':prefix': 'TASK#' } }, 3000);
    return { items: rows.filter((row) => row.programId === query.programId && !row.deletedAt && (request.access.role !== 'facilitator' || row.assigneeId === request.access.staffId || row.createdBy === request.identity.sub)) };
  });

  app.post('/api/tasks', async (request, reply) => {
    const input = taskInputSchema.parse(request.body);
    requireProgram(request.access, input.programId);
    const id = newId('task');
    const timestamp = now();
    const item = { ...input, id, PK: `PROGRAM#${input.programId}`, SK: `TASK#${input.dueDate}#${id}`, GSI3PK: `ASSIGNEE#${input.assigneeId}`, GSI3SK: `DUE#${input.dueDate}#TASK#${id}`, createdBy: request.identity.sub, createdAt: timestamp, updatedAt: timestamp, version: 1, deletedAt: null };
    await db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: config.operationsTable, Item: item, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: config.auditTable, Item: { PK: `ENTITY#task#${id}`, SK: `AUDIT#${timestamp}#${newId('aud')}`, entityType: 'task', entityId: id, programId: input.programId, action: 'create', actorSub: request.identity.sub, at: timestamp } } },
    ] }));
    return reply.code(201).send(item);
  });

  app.patch('/api/tasks/:programId/:dueDate/:id', async (request, reply) => {
    const params = z.object({ programId: programSchema, dueDate: z.iso.date(), id: idSchema }).parse(request.params);
    const body = z.object({ status: z.enum(['open', 'in_progress', 'done']), version: z.number().int().positive() }).parse(request.body);
    requireProgram(request.access, params.programId);
    const key = { PK: `PROGRAM#${params.programId}`, SK: `TASK#${params.dueDate}#${params.id}` };
    const found = await db.send(new GetCommand({ TableName: config.operationsTable, Key: key, ConsistentRead: true }));
    if (!found.Item || found.Item.deletedAt) return reply.code(404).send({ error: 'Task not found' });
    if (request.access.role === 'facilitator' && found.Item.assigneeId !== request.access.staffId && found.Item.createdBy !== request.identity.sub) return reply.code(403).send({ error: 'Task access denied' });
    if (found.Item.version !== body.version) return reply.code(409).send({ error: 'Task changed; reload before saving' });
    const timestamp = now();
    const updated = { ...found.Item, status: body.status, version: body.version + 1, updatedAt: timestamp };
    await db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: config.operationsTable, Item: updated, ConditionExpression: '#version = :version', ExpressionAttributeNames: { '#version': 'version' }, ExpressionAttributeValues: { ':version': body.version } } },
      { Put: { TableName: config.auditTable, Item: { PK: `ENTITY#task#${params.id}`, SK: `AUDIT#${timestamp}#${newId('aud')}`, entityType: 'task', entityId: params.id, programId: params.programId, action: 'status_change', actorSub: request.identity.sub, at: timestamp, before: { status: found.Item.status }, after: { status: body.status } } } },
    ] }));
    return updated;
  });
}
