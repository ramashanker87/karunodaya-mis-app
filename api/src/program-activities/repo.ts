import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { newId, now, queryAll } from '../db.js';
import type { EventInput, EventRecord, Filters, ProgramId } from '../../../shared/schema.js';
import { dateRange } from '../../../shared/report.js';

function item(record: EventRecord) {
  return {
    ...record,
    PK: `PROGRAM#${record.programId}`,
    SK: `EVENT#${record.date}#${record.id}`,
    GSI1PK: `LOCATION#${record.locationId}`,
    GSI1SK: `DATE#${record.date}#EVENT#${record.id}`,
    GSI2PK: `STAFF#${record.facilitatorId}`,
    GSI2SK: `DATE#${record.date}#EVENT#${record.id}`,
  };
}

export async function listEvents(db: Db, config: Config, programId: ProgramId, filters: Filters): Promise<EventRecord[]> {
  const { from, to } = dateRange(filters);
  const byLocation = Boolean(filters.locationId);
  const byStaff = !byLocation && Boolean(filters.facilitatorId);
  const index = byLocation ? 'LocationDateIndex' : byStaff ? 'FacilitatorDateIndex' : undefined;
  const pk = byLocation ? `LOCATION#${filters.locationId}` : byStaff ? `STAFF#${filters.facilitatorId}` : `PROGRAM#${programId}`;
  const start = index ? `DATE#${from}` : `EVENT#${from}`;
  const end = index ? `DATE#${to}#~` : `EVENT#${to}#~`;
  const rows = await queryAll(db, { TableName: config.operationsTable, ...(index ? { IndexName: index } : {}), KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :start AND :end', ExpressionAttributeNames: { '#pk': byLocation ? 'GSI1PK' : byStaff ? 'GSI2PK' : 'PK', '#sk': byLocation ? 'GSI1SK' : byStaff ? 'GSI2SK' : 'SK' }, ExpressionAttributeValues: { ':pk': pk, ':start': start, ':end': end } });
  return rows.filter((row) => row.programId === programId && !row.deletedAt && (!filters.locationId || row.locationId === filters.locationId) && (!filters.facilitatorId || row.facilitatorId === filters.facilitatorId)) as EventRecord[];
}

export async function createEvent(db: Db, config: Config, input: EventInput, actorSub: string): Promise<EventRecord> {
  const timestamp = now();
  const record: EventRecord = { ...input, id: newId('evt'), version: 1, createdAt: timestamp, updatedAt: timestamp, createdBy: actorSub, deletedAt: null };
  await db.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: config.operationsTable, Item: item(record), ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: config.auditTable, Item: { PK: `ENTITY#event#${record.id}`, SK: `AUDIT#${timestamp}#${newId('aud')}`, entityType: 'event', entityId: record.id, programId: record.programId, action: 'create', actorSub, at: timestamp } } },
  ] }));
  return record;
}

export async function getEvent(db: Db, config: Config, programId: ProgramId, date: string, id: string): Promise<EventRecord | null> {
  const result = await db.send(new GetCommand({ TableName: config.operationsTable, Key: { PK: `PROGRAM#${programId}`, SK: `EVENT#${date}#${id}` }, ConsistentRead: true }));
  return result.Item as EventRecord | undefined || null;
}

export async function replaceEvent(db: Db, config: Config, before: EventRecord, input: EventInput, actorSub: string, action: 'update' | 'delete' | 'restore'): Promise<EventRecord> {
  if (before.programId !== input.programId || before.date !== input.date) throw Object.assign(new Error('Program and date cannot change; create a corrected event'), { statusCode: 400 });
  const timestamp = now();
  const after: EventRecord = { ...before, ...input, version: before.version + 1, updatedAt: timestamp, deletedAt: action === 'delete' ? timestamp : action === 'restore' ? null : before.deletedAt };
  const auditId = newId('aud');
  await db.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: config.operationsTable, Item: item(after), ConditionExpression: '#version = :version', ExpressionAttributeNames: { '#version': 'version' }, ExpressionAttributeValues: { ':version': before.version } } },
    { Put: { TableName: config.auditTable, Item: { PK: `ENTITY#event#${before.id}`, SK: `AUDIT#${timestamp}#${auditId}`, entityType: 'event', entityId: before.id, programId: before.programId, eventDate: before.date, action, actorSub, at: timestamp, before: { attendanceTotal: before.attendanceTotal, completed: before.completed, deletedAt: before.deletedAt }, after: { attendanceTotal: after.attendanceTotal, completed: after.completed, deletedAt: after.deletedAt }, ...(action === 'delete' ? { GSI1PK: `DELETED#${before.programId}`, GSI1SK: `AT#${timestamp}#EVENT#${before.id}` } : {}) } } },
  ] }));
  return after;
}
