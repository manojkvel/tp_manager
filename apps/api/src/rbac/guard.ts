// TASK-030 — RBAC guard (§6.13 AC-3).
//
// Returns a Fastify `preHandler` that short-circuits with 401 when the
// request is unauthenticated and 403 when the JWT role is not in the
// allow-list. Role matrix:
//   - owner   — all
//   - manager — all except user admin + settings taxonomies
//   - staff   — view + waste + prep-complete + deliveries (NOT recipe edit)
//
// Usage:
//   app.put('/api/v1/recipes/:id',
//     { preHandler: [requireRole(['owner', 'manager'])] },
//     handler)
//
// Keep this module free of Fastify-specific types beyond the hook signature
// so it can be reused by the aloha-worker HTTP surface later.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Role } from '@tp/types';

function envelope(code: string, message: string) {
  return { data: null, error: { code, message } };
}

export function requireRole(allowed: readonly Role[]): preHandlerHookHandler {
  const allowSet = new Set<Role>(allowed);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) {
      reply.code(401).send(envelope('UNAUTHORIZED', 'authentication required'));
      return;
    }
    if (!allowSet.has(req.auth.role)) {
      reply.code(403).send(envelope('FORBIDDEN', `role '${req.auth.role}' not permitted`));
      return;
    }
  };
}

// Sugar for the common combinations so callers do not re-type the literal list.
export const ownerOnly = (): preHandlerHookHandler => requireRole(['owner']);
export const ownerOrManager = (): preHandlerHookHandler => requireRole(['owner', 'manager']);
export const anyAuthed = (): preHandlerHookHandler => requireRole(['owner', 'manager', 'staff']);
