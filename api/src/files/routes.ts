import type { FastifyInstance } from 'fastify';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { Context } from '../types.js';
import { newId, now } from '../db.js';
import { requireProgram } from '../identity/access.js';
import { idSchema, programSchema } from '../../../shared/schema.js';

const uploadSchema = z.object({ programId: programSchema, filename: z.string().trim().min(1).max(160), contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'text/csv']), size: z.number().int().min(1).max(10_000_000) });

export function registerFileRoutes(app: FastifyInstance, { db, config }: Context) {
  const s3 = new S3Client({ region: config.region });
  app.post('/api/files', async (request, reply) => {
    const input = uploadSchema.parse(request.body);
    requireProgram(request.access, input.programId);
    if (!config.uploadsBucket) return reply.code(503).send({ error: 'File storage is not configured' });
    const id = newId('file');
    const key = `${input.programId}/${id}`;
    const timestamp = now();
    const metadata = { PK: `PROGRAM#${input.programId}`, SK: `FILE#${timestamp}#${id}`, id, programId: input.programId, key, filename: input.filename, contentType: input.contentType, size: input.size, createdAt: timestamp, createdBy: request.identity.sub, status: 'pending' };
    await db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: config.operationsTable, Item: metadata, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: config.auditTable, Item: { PK: `ENTITY#file#${id}`, SK: `AUDIT#${timestamp}#${newId('aud')}`, entityType: 'file', entityId: id, programId: input.programId, action: 'upload_requested', actorSub: request.identity.sub, at: timestamp } } },
    ] }));
    const post = await createPresignedPost(s3, { Bucket: config.uploadsBucket, Key: key, Expires: 300, Fields: { 'Content-Type': input.contentType }, Conditions: [['content-length-range', 1, 10_000_000], ['eq', '$Content-Type', input.contentType]] });
    return reply.code(201).send({ id, uploadUrl: post.url, fields: post.fields, expiresIn: 300 });
  });

  app.get('/api/files/:programId/:createdAt/:id/download', async (request, reply) => {
    const params = z.object({ programId: programSchema, createdAt: z.iso.datetime(), id: idSchema }).parse(request.params);
    requireProgram(request.access, params.programId);
    const found = await db.send(new GetCommand({ TableName: config.operationsTable, Key: { PK: `PROGRAM#${params.programId}`, SK: `FILE#${params.createdAt}#${params.id}` } }));
    if (!found.Item || found.Item.id !== params.id) return reply.code(404).send({ error: 'File not found' });
    if (request.access.role === 'facilitator' && found.Item.createdBy !== request.identity.sub) return reply.code(403).send({ error: 'File access denied' });
    try {
      const object = await s3.send(new HeadObjectCommand({ Bucket: config.uploadsBucket, Key: found.Item.key }));
      if (object.ContentLength !== found.Item.size || object.ContentType !== found.Item.contentType) return reply.code(409).send({ error: 'Uploaded file does not match declared metadata' });
    }
    catch { return reply.code(404).send({ error: 'Upload not completed' }); }
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: config.uploadsBucket, Key: found.Item.key }), { expiresIn: 300 });
    return { downloadUrl: url, expiresIn: 300 };
  });
}
