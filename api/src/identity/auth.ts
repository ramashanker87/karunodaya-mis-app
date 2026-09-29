import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../config.js';

export interface Identity { sub: string; email?: string }

export function createVerifier(config: Config) {
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.cognitoPoolId}`;
  const jwks = config.cognitoPoolId ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;
  return async (request: FastifyRequest): Promise<Identity> => {
    if (config.mockAuth) {
      const sub = request.headers['x-dev-user-sub'];
      if (typeof sub !== 'string' || !/^dev_[A-Za-z0-9_-]+$/.test(sub)) throw new Error('Development identity header required');
      return { sub };
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || !jwks) throw new Error('Bearer access token required');
    const { payload } = await jwtVerify(authorization.slice(7), jwks, {
      issuer,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
      clockTolerance: 5,
    });
    if (payload.token_use !== 'access' || payload.client_id !== config.cognitoClientId || typeof payload.sub !== 'string') {
      throw new Error('Invalid Cognito access token');
    }
    return { sub: payload.sub, email: typeof payload.username === 'string' ? payload.username : undefined };
  };
}
