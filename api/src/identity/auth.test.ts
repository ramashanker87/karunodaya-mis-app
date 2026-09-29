import { describe, expect, it } from 'vitest';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createServer } from '../server.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db.js';

function testDb() {
  const access = new Map<string, Record<string, unknown>>([
    ['dev_pending', { PK: 'USER#dev_pending', SK: 'PROFILE', sub: 'dev_pending', status: 'pending', programIds: [], version: 1 }],
    ['dev_facilitator', { PK: 'USER#dev_facilitator', SK: 'PROFILE', sub: 'dev_facilitator', status: 'approved', role: 'facilitator', programIds: ['udyam'], staffId: 'staff_demo_1', version: 1 }],
  ]);
  return { send: async (command: unknown) => {
    if (command instanceof GetCommand) return { Item: access.get(String(command.input.Key?.PK).replace('USER#', '')) };
    if (command instanceof PutCommand) return {};
    if (command instanceof QueryCommand) return { Items: [] };
    throw new Error('Unexpected database command');
  } } as unknown as Db;
}

const config = loadConfig({ NODE_ENV: 'development', DEV_MOCK_AUTH: 'true' });

describe('API authorization', () => {
  it('requires a development identity even in local mode', async () => {
    const app = createServer(config, testDb());
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('lets pending users inspect their own approval state but blocks reports', async () => {
    const app = createServer(config, testDb());
    const headers = { 'x-dev-user-sub': 'dev_pending' };
    expect((await app.inject({ method: 'GET', url: '/api/me', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/reports/summary?programId=udyam&programYear=2026', headers })).statusCode).toBe(403);
    await app.close();
  });

  it('blocks a facilitator from a program outside their assignment', async () => {
    const app = createServer(config, testDb());
    const response = await app.inject({ method: 'GET', url: '/api/events?programId=llp&programYear=2026', headers: { 'x-dev-user-sub': 'dev_facilitator' } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('cannot enable mock authentication in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DEV_MOCK_AUTH: 'true' })).toThrow('forbidden');
  });
});
