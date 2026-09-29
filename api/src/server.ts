import Fastify from 'fastify';
import { ZodError } from 'zod';
import { loadConfig, type Config } from './config.js';
import { createDb, type Db } from './db.js';
import { createVerifier } from './identity/auth.js';
import { getOrCreateAccess } from './identity/access.js';
import { registerIdentityRoutes } from './identity/routes.js';
import { registerEventRoutes } from './program-activities/routes.js';
import { registerDirectoryRoutes } from './program-activities/directory.js';
import { registerStudentRoutes } from './students/routes.js';
import { registerTaskRoutes } from './tasks/routes.js';
import { registerReportRoutes } from './reporting/routes.js';
import { registerFileRoutes } from './files/routes.js';

export function createServer(config: Config = loadConfig(), db: Db = createDb(config)) {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  const verify = createVerifier(config);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
    const safeError = error as Error & { statusCode?: number };
    const status = typeof safeError.statusCode === 'number' ? safeError.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? 'Internal server error' : safeError.message });
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    try {
      request.identity = await verify(request);
    } catch {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    request.access = await getOrCreateAccess(db, config, request.identity.sub);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'private, no-store');
    return payload;
  });

  app.get('/healthz', async () => ({ ok: true }));
  const context = { db, config };
  registerIdentityRoutes(app, context);
  registerDirectoryRoutes(app, context);
  registerEventRoutes(app, context);
  registerStudentRoutes(app, context);
  registerTaskRoutes(app, context);
  registerReportRoutes(app, context);
  registerFileRoutes(app, context);
  return app;
}

if (process.argv[1]?.endsWith('/server.js') || process.argv[1]?.endsWith('/server.ts')) {
  const config = loadConfig();
  createServer(config).listen({ port: config.port, host: '0.0.0.0' }).catch((error) => {
    console.error('API startup failed:', error.message);
    process.exitCode = 1;
  });
}
