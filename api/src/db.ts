import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Config } from './config.js';

export function createDb(config: Config) {
  const client = new DynamoDBClient({
    region: config.region,
    ...(config.dynamoEndpoint ? { endpoint: config.dynamoEndpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
  });
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}
export type Db = ReturnType<typeof createDb>;

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function now(): string { return new Date().toISOString(); }

export async function queryAll(db: Db, input: ConstructorParameters<typeof QueryCommand>[0], maxItems = 10000): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const result = await db.send(new QueryCommand({ ...input, ExclusiveStartKey: cursor }));
    items.push(...(result.Items || []));
    cursor = result.LastEvaluatedKey;
    if (items.length > maxItems) throw Object.assign(new Error('Report range is too large; narrow the filters'), { statusCode: 413 });
  } while (cursor);
  return items;
}
