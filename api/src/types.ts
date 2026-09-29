import type { Db } from './db.js';
import type { Config } from './config.js';
import type { Identity } from './identity/auth.js';
import type { AccessProfile } from './identity/access.js';

export interface Context { db: Db; config: Config }

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity;
    access: AccessProfile;
  }
}
