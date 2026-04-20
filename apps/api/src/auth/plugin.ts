// TASK-029 — Fastify auth plugin (AD-6).
//
// Parses `Authorization: Bearer <jwt>`, verifies via tokens.ts, and decorates
// `req.auth` with the claims. Handlers that need "any authenticated user" use
// `requireAuth`. Handlers that need specific roles use `requireRole(...)` from
// rbac/guard.ts (TASK-030). A missing or malformed token yields 401; an
// expired or wrong-signed token yields 401. RBAC denial yields 403.

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { verifyAccessToken, type AccessTokenClaims } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessTokenClaims;
  }
}

export interface AuthPluginOpts {
  jwtSecret: string;
  jwtIssuer?: string;
  jwtAudience?: string;
}

const plugin: FastifyPluginAsync<AuthPluginOpts> = async (
  app: FastifyInstance,
  opts: AuthPluginOpts,
) => {
  app.decorateRequest('auth', undefined);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return;
    try {
      req.auth = await verifyAccessToken(token, {
        secret: opts.jwtSecret,
        issuer: opts.jwtIssuer,
        audience: opts.jwtAudience,
      });
    } catch {
      // Leave req.auth undefined; requireAuth / requireRole will 401.
    }
  });
};

export const authPlugin = fp(plugin, { name: 'auth' });

export const requireAuth: preHandlerHookHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.auth) {
    reply.code(401).send({ data: null, error: { code: 'UNAUTHORIZED', message: 'authentication required' } });
  }
};
