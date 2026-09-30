import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { FastifyInstance } from 'fastify';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { Context } from '../types.js';
import { accessChangeSchema } from '../../../shared/schema.js';
import { changeAccess, pendingUsers, requireRole, type AccessProfile } from './access.js';

export function registerIdentityRoutes(app: FastifyInstance, { db, config }: Context) {
  const cognito = new CognitoIdentityProviderClient({ region: config.region });
  app.addHook('onClose', async () => { cognito.destroy(); });

  app.get('/api/me', async (request) => ({ sub: request.identity.sub, status: request.access.status, role: request.access.role ?? null, programIds: request.access.programIds, staffId: request.access.staffId ?? null }));

  app.get('/api/admin/users/pending', async (request) => {
    requireRole(request.access, 'admin');
    const pending = await pendingUsers(db, config);
    const items = [];
    for (const user of pending) {
      // Resolve current attributes by stable subject, including requests predating this feature.
      const result = config.mockAuth ? undefined : await cognito.send(new ListUsersCommand({
        UserPoolId: config.cognitoPoolId,
        Filter: `sub = ${JSON.stringify(user.sub)}`,
      }));
      const attributes = result?.Users?.find((entry) => entry.Attributes?.some((a) => a.Name === 'sub' && a.Value === user.sub))?.Attributes;
      const attribute = (name: string) => attributes?.find((entry) => entry.Name === name)?.Value ?? null;
      items.push({ sub: user.sub, createdAt: user.createdAt, email: attribute('email'), name: attribute('name') });
    }
    return { items };
  });

  app.get('/api/admin/users/:sub/access', async (request, reply) => {
    requireRole(request.access, 'admin');
    const { sub } = z.object({ sub: z.string().min(1).max(200) }).parse(request.params);
    const found = await db.send(new GetCommand({ TableName: config.accessTable, Key: { PK: `USER#${sub}`, SK: 'PROFILE' }, ConsistentRead: true }));
    if (!found.Item) return reply.code(404).send({ error: 'User has not signed in yet' });
    const profile = found.Item as AccessProfile;
    return { sub: profile.sub, status: profile.status, role: profile.role ?? null, programIds: profile.programIds, staffId: profile.staffId ?? null, version: profile.version };
  });

  app.put('/api/admin/users/:sub/access', async (request, reply) => {
    requireRole(request.access, 'admin');
    const { sub } = z.object({ sub: z.string().min(1).max(200) }).parse(request.params);
    const change = accessChangeSchema.parse(request.body);
    const found = await db.send(new GetCommand({ TableName: config.accessTable, Key: { PK: `USER#${sub}`, SK: 'PROFILE' }, ConsistentRead: true }));
    if (!found.Item) return reply.code(404).send({ error: 'User has not signed in yet' });
    const updated = await changeAccess(db, config, request.access, found.Item as AccessProfile, change);
    return { sub: updated.sub, status: updated.status, role: updated.role, programIds: updated.programIds, staffId: updated.staffId, version: updated.version };
  });
}
