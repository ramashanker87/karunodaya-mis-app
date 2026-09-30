import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { registerIdentityRoutes } from './routes.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db.js';

const lookup = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send');
afterEach(() => lookup.mockReset());

function server(role: 'admin' | 'facilitator') {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.access = { PK: 'USER#operator', SK: 'PROFILE', sub: 'operator', status: 'approved', role, programIds: [], createdAt: '', updatedAt: '', version: 1 };
  });
  const db = { send: vi.fn().mockResolvedValue({ Items: [{ sub: 'requester-sub', createdAt: '2026-09-29T00:00:00Z' }] }) } as unknown as Db;
  registerIdentityRoutes(app, { db, config: loadConfig({ NODE_ENV: 'test', AWS_REGION: 'ap-south-1', COGNITO_USER_POOL_ID: 'pool' }) });
  return app;
}

describe('Pending approval identity details', () => {
  it('resolves an existing request by subject and returns its Cognito email and name', async () => {
    lookup.mockResolvedValue({ Users: [{ Attributes: [{ Name: 'sub', Value: 'requester-sub' }, { Name: 'email', Value: 'requester@example.com' }, { Name: 'name', Value: 'Requester' }] }] } as never);
    const app = server('admin');
    const response = await app.inject('/api/admin/users/pending');
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([{ sub: 'requester-sub', createdAt: '2026-09-29T00:00:00Z', email: 'requester@example.com', name: 'Requester' }]);
    expect(lookup.mock.calls[0][0].input).toMatchObject({ Filter: 'sub = "requester-sub"', UserPoolId: 'pool' });
    await app.close();
  });
  it('does not disclose another identity when the directory does not match the subject', async () => {
    lookup.mockResolvedValue({ Users: [{ Attributes: [{ Name: 'sub', Value: 'different-sub' }, { Name: 'email', Value: 'other@example.com' }] }] } as never);
    const app = server('admin');
    const response = await app.inject('/api/admin/users/pending');
    expect(response.json().items[0].email).toBeNull();
    await app.close();
  });
  it('blocks non-admins before looking up email addresses', async () => {
    const app = server('facilitator');
    expect((await app.inject('/api/admin/users/pending')).statusCode).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
    await app.close();
  });
});
