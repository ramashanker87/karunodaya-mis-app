import type { FastifyInstance } from 'fastify';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { Context } from '../types.js';
import { newId, now, queryAll } from '../db.js';
import { canSeeStudents, requireProgram } from '../identity/access.js';
import { enrollmentStatusSchema, idSchema, programSchema, studentInputSchema } from '../../../shared/schema.js';

const statusInputSchema = z.object({ status: enrollmentStatusSchema, effectiveDate: z.iso.date(), dropOutStatus: z.string().max(200).nullable().default(null), version: z.number().int().positive() });

export function registerStudentRoutes(app: FastifyInstance, { db, config }: Context) {
  app.get('/api/students', async (request, reply) => {
    if (!canSeeStudents(request.access)) return reply.code(403).send({ error: 'Student registry access denied' });
    const query = z.object({ programId: programSchema, status: enrollmentStatusSchema.optional(), locationId: idSchema.optional() }).parse(request.query);
    requireProgram(request.access, query.programId);
    const statuses = query.status ? [query.status] : enrollmentStatusSchema.options;
    const enrollments = (await Promise.all(statuses.map((status) => queryAll(db, {
      TableName: config.studentsTable, IndexName: 'ProgramEnrollmentIndex', KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `PROGRAM#${query.programId}#STATUS#${status}` },
    }, 3000)))).flat().filter((item) => !query.locationId || item.locationId === query.locationId);
    const students = await Promise.all(enrollments.map(async (enrollment) => {
      const result = await db.send(new GetCommand({ TableName: config.studentsTable, Key: { PK: enrollment.PK, SK: 'PROFILE' } }));
      return result.Item ? { ...result.Item, enrollment } : null;
    }));
    return { items: students.filter(Boolean) };
  });

  app.post('/api/students', async (request, reply) => {
    if (!canSeeStudents(request.access)) return reply.code(403).send({ error: 'Student creation denied' });
    const input = studentInputSchema.parse(request.body);
    requireProgram(request.access, input.programId);
    const id = newId('stu');
    const timestamp = now();
    const PK = `STUDENT#${id}`;
    const profile = { PK, SK: 'PROFILE', id, name: input.name, dateOfBirth: input.dateOfBirth, gender: input.gender, createdAt: timestamp, updatedAt: timestamp };
    const enrollment = { PK, SK: `ENROLLMENT#${input.programId}`, studentId: id, programId: input.programId, status: input.status, dropOutStatus: input.dropOutStatus, locationId: input.locationId, enrolledOn: input.enrolledOn, effectiveDate: input.enrolledOn, version: 1, GSI1PK: `PROGRAM#${input.programId}#STATUS#${input.status}`, GSI1SK: `LOCATION#${input.locationId}#STUDENT#${id}` };
    await db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: config.studentsTable, Item: profile, ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: config.studentsTable, Item: enrollment } },
      { Put: { TableName: config.studentsTable, Item: { PK, SK: `HISTORY#${input.enrolledOn}#${newId('hist')}`, studentId: id, programId: input.programId, kind: 'enrollment', effectiveDate: input.enrolledOn, from: null, to: input.status, dropOutStatus: input.dropOutStatus } } },
      { Put: { TableName: config.auditTable, Item: { PK: `ENTITY#student#${id}`, SK: `AUDIT#${timestamp}#${newId('aud')}`, entityType: 'student', entityId: id, programId: input.programId, action: 'create', actorSub: request.identity.sub, at: timestamp } } },
    ] }));
    return reply.code(201).send({ ...profile, enrollment });
  });

  app.get('/api/students/:id', async (request, reply) => {
    if (!canSeeStudents(request.access)) return reply.code(403).send({ error: 'Student profile access denied' });
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const items = await queryAll(db, { TableName: config.studentsTable, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `STUDENT#${id}` }, ConsistentRead: true }, 1000);
    const enrollments = items.filter((item) => String(item.SK).startsWith('ENROLLMENT#'));
    if (!enrollments.length) return reply.code(404).send({ error: 'Student not found' });
    for (const enrollment of enrollments) requireProgram(request.access, programSchema.parse(enrollment.programId));
    return { profile: items.find((item) => item.SK === 'PROFILE'), enrollments, history: items.filter((item) => String(item.SK).startsWith('HISTORY#')) };
  });

  app.post('/api/students/:id/status', async (request, reply) => {
    if (!canSeeStudents(request.access)) return reply.code(403).send({ error: 'Status change denied' });
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const body = statusInputSchema.extend({ programId: programSchema }).parse(request.body);
    requireProgram(request.access, body.programId);
    const key = { PK: `STUDENT#${id}`, SK: `ENROLLMENT#${body.programId}` };
    const found = await db.send(new GetCommand({ TableName: config.studentsTable, Key: key, ConsistentRead: true }));
    if (!found.Item) return reply.code(404).send({ error: 'Enrollment not found' });
    if (found.Item.version !== body.version) return reply.code(409).send({ error: 'Enrollment changed; reload before saving' });
    if (body.effectiveDate < found.Item.enrolledOn) return reply.code(400).send({ error: 'Status date cannot precede enrollment' });
    const timestamp = now();
    const becomesCurrent = body.effectiveDate >= (found.Item.effectiveDate || found.Item.enrolledOn);
    const next = { ...found.Item, ...(becomesCurrent ? { status: body.status, dropOutStatus: body.dropOutStatus, effectiveDate: body.effectiveDate, GSI1PK: `PROGRAM#${body.programId}#STATUS#${body.status}` } : {}), version: body.version + 1, updatedAt: timestamp };
    await db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: config.studentsTable, Item: next, ConditionExpression: '#version = :version', ExpressionAttributeNames: { '#version': 'version' }, ExpressionAttributeValues: { ':version': body.version } } },
      { Put: { TableName: config.studentsTable, Item: { PK: key.PK, SK: `HISTORY#${body.effectiveDate}#${newId('hist')}`, studentId: id, programId: body.programId, kind: 'status', effectiveDate: body.effectiveDate, from: becomesCurrent ? found.Item.status : null, to: body.status, dropOutStatus: body.dropOutStatus, backdated: !becomesCurrent } } },
      { Put: { TableName: config.auditTable, Item: { PK: `ENTITY#student#${id}`, SK: `AUDIT#${timestamp}#${newId('aud')}`, entityType: 'student', entityId: id, programId: body.programId, action: 'status_change', actorSub: request.identity.sub, at: timestamp, before: { status: found.Item.status }, after: { status: body.status } } } },
    ] }));
    return { enrollment: next };
  });
}
