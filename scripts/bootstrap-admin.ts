import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const sub = process.env.BOOTSTRAP_COGNITO_SUB;
const accessTable = process.env.ACCESS_TABLE;
const auditTable = process.env.AUDIT_TABLE;
if (!sub || !accessTable || !auditTable) throw new Error('Set BOOTSTRAP_COGNITO_SUB, ACCESS_TABLE, and AUDIT_TABLE from the stack outputs.');
if (!/^[A-Za-z0-9_-]{5,200}$/.test(sub)) throw new Error('Invalid Cognito sub');
const timestamp = new Date().toISOString();
const profile = { PK: `USER#${sub}`, SK: 'PROFILE', sub, status: 'approved', role: 'admin', programIds: ['udyam', 'sambodhi', 'llp', 'sapno'], createdAt: timestamp, updatedAt: timestamp, version: 1 };
if (!process.argv.includes('--apply')) {
  process.stdout.write(`${JSON.stringify({ mode: 'dry-run', profile, instruction: 'Pass --apply with an AWS profile only after verifying the Cognito sub.' }, null, 2)}\n`);
} else {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  await db.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: accessTable, Item: profile, ConditionExpression: 'attribute_not_exists(PK)' } },
    { Put: { TableName: auditTable, Item: { PK: `ENTITY#user#${sub}`, SK: `AUDIT#${timestamp}#${randomUUID()}`, entityType: 'user', entityId: sub, action: 'bootstrap_admin', actorSub: 'deployment-operator', at: timestamp, after: { role: 'admin', status: 'approved', programIds: profile.programIds } } } },
  ] }));
  process.stdout.write(`Initial Admin access created for ${sub}.\n`);
}
