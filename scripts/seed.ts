import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, waitUntilTableExists, type AttributeDefinition } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
const region = process.env.AWS_REGION || 'us-east-1';
const raw = new DynamoDBClient({ region, endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
const db = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
const tables = {
  operations: process.env.OPERATIONS_TABLE || 'karunodaya-local-operations',
  students: process.env.STUDENTS_TABLE || 'karunodaya-local-students',
  audit: process.env.AUDIT_TABLE || 'karunodaya-local-audit',
  access: process.env.ACCESS_TABLE || 'karunodaya-local-access',
};

async function ensureTable(name: string, indexes: { name: string; pk: string; sk: string }[]) {
  try { await raw.send(new DescribeTableCommand({ TableName: name })); return; }
  catch (error) { if ((error as Error).name !== 'ResourceNotFoundException') throw error; }
  const keys = new Set(['PK', 'SK', ...indexes.flatMap((index) => [index.pk, index.sk])]);
  await raw.send(new CreateTableCommand({
    TableName: name,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [...keys].map((AttributeName) => ({ AttributeName, AttributeType: 'S' as const })) as AttributeDefinition[],
    KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
    GlobalSecondaryIndexes: indexes.map((index) => ({ IndexName: index.name, KeySchema: [{ AttributeName: index.pk, KeyType: 'HASH' }, { AttributeName: index.sk, KeyType: 'RANGE' }], Projection: { ProjectionType: 'ALL' } })),
  }));
  await waitUntilTableExists({ client: raw, maxWaitTime: 30 }, { TableName: name });
}

async function put(table: string, item: Record<string, unknown>) { await db.send(new PutCommand({ TableName: table, Item: item })); }

await ensureTable(tables.operations, [
  { name: 'LocationDateIndex', pk: 'GSI1PK', sk: 'GSI1SK' },
  { name: 'FacilitatorDateIndex', pk: 'GSI2PK', sk: 'GSI2SK' },
  { name: 'AssigneeDueIndex', pk: 'GSI3PK', sk: 'GSI3SK' },
]);
await ensureTable(tables.students, [{ name: 'ProgramEnrollmentIndex', pk: 'GSI1PK', sk: 'GSI1SK' }]);
await ensureTable(tables.audit, [{ name: 'DeletedIndex', pk: 'GSI1PK', sk: 'GSI1SK' }]);
await ensureTable(tables.access, [{ name: 'ApprovalIndex', pk: 'GSI1PK', sk: 'GSI1SK' }]);

const programs = ['udyam', 'sambodhi', 'llp', 'sapno'];
for (const [index, programId] of programs.entries()) {
  const locationId = `loc_demo_${index + 1}`;
  const staffId = `staff_demo_${index + 1}`;
  const eventId = `evt_demo_${index + 1}`;
  await put(tables.operations, { PK: `PROGRAM#${programId}`, SK: `LOCATION#${locationId}`, id: locationId, programId, kind: 'centre', name: `Demo Centre ${index + 1}`, createdAt: '2026-04-01T00:00:00Z', createdBy: 'dev_admin' });
  await put(tables.operations, { PK: `PROGRAM#${programId}`, SK: `STAFF#${staffId}`, id: staffId, programId, kind: 'staff', name: `Demo Facilitator ${index + 1}`, createdAt: '2026-04-01T00:00:00Z', createdBy: 'dev_admin' });
  await put(tables.operations, { PK: `PROGRAM#${programId}`, SK: `EVENT#2026-07-18#${eventId}`, id: eventId, programId, kind: 'activity', activityType: 'Synthetic learning session', date: '2026-07-18', locationId, facilitatorId: staffId, attendanceTotal: 3 + index, participantIds: [`stu_demo_${index + 1}`], completed: true, notes: 'Synthetic sample data', details: {}, version: 1, createdAt: '2026-07-18T10:00:00Z', updatedAt: '2026-07-18T10:00:00Z', createdBy: 'dev_admin', deletedAt: null, GSI1PK: `LOCATION#${locationId}`, GSI1SK: `DATE#2026-07-18#EVENT#${eventId}`, GSI2PK: `STAFF#${staffId}`, GSI2SK: `DATE#2026-07-18#EVENT#${eventId}` });
  const studentId = `stu_demo_${index + 1}`;
  await put(tables.students, { PK: `STUDENT#${studentId}`, SK: 'PROFILE', id: studentId, name: `Synthetic Student ${index + 1}`, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' });
  await put(tables.students, { PK: `STUDENT#${studentId}`, SK: `ENROLLMENT#${programId}`, studentId, programId, status: 'active', dropOutStatus: null, locationId, enrolledOn: '2026-07-01', effectiveDate: '2026-07-01', version: 1, GSI1PK: `PROGRAM#${programId}#STATUS#active`, GSI1SK: `LOCATION#${locationId}#STUDENT#${studentId}` });
  await put(tables.students, { PK: `STUDENT#${studentId}`, SK: `HISTORY#2026-07-01#hist_demo_${index + 1}`, studentId, programId, kind: 'enrollment', effectiveDate: '2026-07-01', from: null, to: 'active' });
}
await put(tables.access, { PK: 'USER#dev_admin', SK: 'PROFILE', sub: 'dev_admin', status: 'approved', role: 'admin', programIds: programs, createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z', version: 1 });
await put(tables.access, { PK: 'USER#dev_manager', SK: 'PROFILE', sub: 'dev_manager', status: 'approved', role: 'program_manager', programIds: ['udyam'], createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z', version: 1 });
await put(tables.access, { PK: 'USER#dev_facilitator', SK: 'PROFILE', sub: 'dev_facilitator', status: 'approved', role: 'facilitator', programIds: ['udyam'], staffId: 'staff_demo_1', createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z', version: 1 });
await put(tables.access, { PK: 'USER#dev_pending', SK: 'PROFILE', sub: 'dev_pending', status: 'pending', programIds: [], GSI1PK: 'APPROVAL#PENDING', GSI1SK: '2026-04-01T00:00:00Z#dev_pending', createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z', version: 1 });
console.log('DynamoDB Local seeded with synthetic data only.');
