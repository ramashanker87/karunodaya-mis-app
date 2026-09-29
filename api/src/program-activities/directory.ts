import type { FastifyInstance } from 'fastify';
import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { Context } from '../types.js';
import { newId, now } from '../db.js';
import { requireProgram, requireRole } from '../identity/access.js';
import { programSchema } from '../../../shared/schema.js';

const directoryInput = z.object({ programId: programSchema, kind: z.enum(['school', 'centre', 'village', 'staff']), name: z.string().trim().min(2).max(150) });

export function registerDirectoryRoutes(app: FastifyInstance, { db, config }: Context) {
  app.get('/api/directory', async (request) => {
    const { programId } = z.object({ programId: programSchema }).parse(request.query);
    requireProgram(request.access, programId);
    const rows = await Promise.all(['LOCATION#', 'STAFF#'].map((prefix) => db.send(new QueryCommand({ TableName: config.operationsTable, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)', ExpressionAttributeValues: { ':pk': `PROGRAM#${programId}`, ':prefix': prefix } }))));
    return { items: rows.flatMap((row) => row.Items || []).filter((item) => !item.deletedAt) };
  });

  app.post('/api/directory', async (request, reply) => {
    requireRole(request.access, 'admin', 'program_manager');
    const input = directoryInput.parse(request.body);
    requireProgram(request.access, input.programId);
    const id = newId(input.kind === 'staff' ? 'staff' : 'loc');
    const timestamp = now();
    const record = { ...input, id, PK: `PROGRAM#${input.programId}`, SK: `${input.kind === 'staff' ? 'STAFF' : 'LOCATION'}#${id}`, createdAt: timestamp, createdBy: request.identity.sub };
    await db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: config.operationsTable, Item: record, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: config.auditTable, Item: { PK: `ENTITY#directory#${id}`, SK: `AUDIT#${timestamp}#${newId('aud')}`, entityType: 'directory', entityId: id, programId: input.programId, action: 'create', actorSub: request.identity.sub, at: timestamp } } },
    ] }));
    return reply.code(201).send(record);
  });
}
