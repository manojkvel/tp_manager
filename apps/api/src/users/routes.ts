// User-admin HTTP routes (§6.11, §6.13) — all owner-only.

import type { FastifyInstance } from 'fastify';
import type { Role } from '@tp/types';
import { ownerOnly } from '../rbac/guard.js';
import {
  UserAdminService,
  DuplicateEmailError, UserNotFoundError, CannotDemoteLastOwnerError,
} from './service.js';

const ROLES: readonly Role[] = ['owner', 'manager', 'staff'];

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

function redact<T extends { id: string; email: string; name: string | null; role: Role; active: boolean; last_login_at: Date | null; created_at: Date }>(u: T) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
  };
}

export async function registerUserAdminRoutes(app: FastifyInstance, svc: UserAdminService): Promise<void> {
  app.get<{ Querystring: { includeInactive?: string } }>(
    '/api/v1/users',
    { preHandler: [ownerOnly()] },
    async (req) => {
      const rows = await svc.list(req.auth!.restaurant_id, {
        includeInactive: req.query.includeInactive === 'true',
      });
      return envelope(rows.map(redact), null);
    },
  );

  app.post<{ Body: { email?: string; name?: string; role?: Role } }>(
    '/api/v1/users/invite',
    { preHandler: [ownerOnly()] },
    async (req, reply) => {
      const email = (req.body?.email ?? '').trim();
      const role = req.body?.role;
      if (!email || !role || !ROLES.includes(role)) {
        return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: 'email and role (owner|manager|staff) required' }));
      }
      try {
        const result = await svc.invite(req.auth!.restaurant_id, { email, name: req.body?.name, role });
        return reply.code(201).send(envelope({ user: redact(result.user), resetToken: result.resetToken }, null));
      } catch (err) {
        if (err instanceof DuplicateEmailError) {
          return reply.code(409).send(envelope(null, { code: 'DUPLICATE', message: err.message }));
        }
        if (err instanceof Error && err.message === 'invalid email') {
          return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.put<{ Params: { id: string }; Body: { role?: Role } }>(
    '/api/v1/users/:id/role',
    { preHandler: [ownerOnly()] },
    async (req, reply) => {
      const role = req.body?.role;
      if (!role || !ROLES.includes(role)) {
        return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: 'role (owner|manager|staff) required' }));
      }
      try {
        const row = await svc.setRole(req.auth!.restaurant_id, req.params.id, role);
        return envelope(redact(row), null);
      } catch (err) {
        if (err instanceof UserNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if (err instanceof CannotDemoteLastOwnerError) {
          return reply.code(409).send(envelope(null, { code: 'LAST_OWNER', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/users/:id/deactivate',
    { preHandler: [ownerOnly()] },
    async (req, reply) => {
      try {
        await svc.deactivate(req.auth!.restaurant_id, req.params.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof UserNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if (err instanceof CannotDemoteLastOwnerError) {
          return reply.code(409).send(envelope(null, { code: 'LAST_OWNER', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/users/:id/reactivate',
    { preHandler: [ownerOnly()] },
    async (req, reply) => {
      try {
        await svc.reactivate(req.auth!.restaurant_id, req.params.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof UserNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );
}
