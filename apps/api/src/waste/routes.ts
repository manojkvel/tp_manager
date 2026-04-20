// TASK-060 — Waste HTTP routes (§6.8).

import type { FastifyInstance } from 'fastify';
import { anyAuthed } from '../rbac/guard.js';
import { WasteService, WasteValidationError, type CreateWasteInput } from './service.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export async function registerWasteRoutes(app: FastifyInstance, svc: WasteService): Promise<void> {
  app.post<{ Body: CreateWasteInput }>(
    '/api/v1/waste',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const e = await svc.log(req.auth!.restaurant_id, { ...req.body, user_id: req.auth!.sub });
        return reply.code(201).send(envelope(e, null));
      } catch (err) {
        if (err instanceof WasteValidationError) {
          return reply.code(422).send(envelope(null, { code: 'VALIDATION', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.get<{ Querystring: { since?: string } }>(
    '/api/v1/waste',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 7 * 86_400_000);
      return envelope(await svc.list(req.auth!.restaurant_id, since), null);
    },
  );

  app.get('/api/v1/waste/expired-suggestions', { preHandler: [anyAuthed()] }, async (req) =>
    envelope(await svc.expiredSuggestions(req.auth!.restaurant_id), null),
  );
}
