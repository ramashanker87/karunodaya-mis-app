import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Db } from '../db.js';
import { newId, now } from '../db.js';
import type { Config } from '../config.js';
import type { ProgramId, Role } from '../../../shared/schema.js';

export interface AccessProfile {
  PK: string;
  SK: 'PROFILE';
  sub: string;
  status: 'pending' | 'approved' | 'suspended';
  role?: Role;
  programIds: ProgramId[];
  staffId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK?: string;
  GSI1SK?: string;
}

export async function getOrCreateAccess(db: Db, config: Config, sub: string): Promise<AccessProfile> {
  const key = { PK: `USER#${sub}`, SK: 'PROFILE' as const };
  const found = await db.send(new GetCommand({ TableName: config.accessTable, Key: key, ConsistentRead: true }));
  if (found.Item) return found.Item as AccessProfile;
  const createdAt = now();
  const pending: AccessProfile = { ...key, sub, status: 'pending', programIds: [], createdAt, updatedAt: createdAt, version: 1, GSI1PK: 'APPROVAL#PENDING', GSI1SK: `${createdAt}#${sub}` };
  try { await db.send(new PutCommand({ TableName: config.accessTable, Item: pending, ConditionExpression: 'attribute_not_exists(PK)' })); }
  catch (error) { if ((error as Error).name !== 'ConditionalCheckFailedException') throw error; }
  const current = await db.send(new GetCommand({ TableName: config.accessTable, Key: key, ConsistentRead: true }));
  return current.Item as AccessProfile;
}

export function requireApproved(profile: AccessProfile): void {
  if (profile.status !== 'approved') throw Object.assign(new Error('Account approval required'), { statusCode: 403 });
}
export function requireRole(profile: AccessProfile, ...allowed: Role[]): void {
  requireApproved(profile);
  if (!profile.role || !allowed.includes(profile.role)) throw Object.assign(new Error('Role not permitted'), { statusCode: 403 });
}
export function requireProgram(profile: AccessProfile, programId: ProgramId): void {
  requireApproved(profile);
  if (profile.role !== 'admin' && !profile.programIds.includes(programId)) throw Object.assign(new Error('Program not assigned'), { statusCode: 403 });
}
export function canSeeStudents(profile: AccessProfile): boolean {
  return profile.status === 'approved' && (profile.role === 'admin' || profile.role === 'program_manager');
}
export function canChangeRecord(profile: AccessProfile, createdBy: string): boolean {
  return profile.role === 'admin' || profile.role === 'program_manager' || profile.sub === createdBy;
}

export async function pendingUsers(db: Db, config: Config): Promise<AccessProfile[]> {
  const result = await db.send(new QueryCommand({ TableName: config.accessTable, IndexName: 'ApprovalIndex', KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': 'APPROVAL#PENDING' } }));
  return (result.Items || []) as AccessProfile[];
}

export async function changeAccess(db: Db, config: Config, actor: AccessProfile, target: AccessProfile, change: { role: Role; programIds: ProgramId[]; status: 'approved' | 'suspended'; staffId?: string }): Promise<AccessProfile> {
  requireRole(actor, 'admin');
  if (actor.sub === target.sub && change.role !== 'admin') throw Object.assign(new Error('Cannot remove own Admin role'), { statusCode: 400 });
  const updatedAt = now();
  const updated: AccessProfile = { ...target, ...change, updatedAt, version: target.version + 1 };
  delete updated.GSI1PK;
  delete updated.GSI1SK;
  await db.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: config.accessTable, Item: updated, ConditionExpression: '#version = :version', ExpressionAttributeNames: { '#version': 'version' }, ExpressionAttributeValues: { ':version': target.version } } },
    { Put: { TableName: config.auditTable, Item: { PK: `ENTITY#user#${target.sub}`, SK: `AUDIT#${updatedAt}#${newId('aud')}`, entityType: 'user', entityId: target.sub, action: 'access_change', actorSub: actor.sub, at: updatedAt, before: { role: target.role ?? null, programIds: target.programIds, status: target.status }, after: { role: change.role, programIds: change.programIds, status: change.status } } } },
  ] }));
  return updated;
}
