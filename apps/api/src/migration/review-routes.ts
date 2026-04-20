// TASK-061 — Migration review HTTP routes (§6.14 AC-4..7).

import type { FastifyInstance } from 'fastify';
import { ownerOnly } from '../rbac/guard.js';
import {
  MigrationReviewService, ReviewBatchNotFoundError, ReviewBatchAlreadyProcessedError, ReviewRollbackWindowError,
} from './review.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export async function registerMigrationReviewRoutes(
  app: FastifyInstance, svc: MigrationReviewService,
): Promise<void> {
  app.get('/api/v1/migration/batches', { preHandler: [ownerOnly()] }, async (req) =>
    envelope(await svc.listBatches(req.auth!.restaurant_id), null),
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/migration/batches/:id',
    { preHandler: [ownerOnly()] },
    async (req, reply) => {
      try { return envelope(await svc.getBatch(req.auth!.restaurant_id, req.params.id), null); }
      catch (err) {
        if (err instanceof ReviewBatchNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{
    Params: { id: string; item_id: string };
    Body: { decision: 'accept_new' | 'merge' | 'reject'; target_id?: string | null };
  }>(
    '/api/v1/migration/batches/:id/items/:item_id/decision',
    { preHandler: [ownerOnly()] },
    async (req, reply) => {
      try {
        await svc.setItemDecision(
          req.auth!.restaurant_id, req.params.id, req.params.item_id,
          req.body.decision, req.body.target_id,
        );
        return envelope({ ok: true }, null);
      } catch (err) {
        if (err instanceof ReviewBatchNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if (err instanceof ReviewBatchAlreadyProcessedError) {
          return reply.code(409).send(envelope(null, { code: 'ALREADY_PROCESSED', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/migration/batches/:id/approve',
    { preHandler: [ownerOnly()] },
    async (req, reply) => {
      try {
        const out = await svc.approve(req.auth!.restaurant_id, req.params.id, req.auth!.sub);
        return envelope(out, null);
      } catch (err) {
        if (err instanceof ReviewBatchNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if (err instanceof ReviewBatchAlreadyProcessedError) {
          return reply.code(409).send(envelope(null, { code: 'ALREADY_PROCESSED', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/migration/batches/:id/rollback',
    { preHandler: [ownerOnly()] },
    async (req, reply) => {
      try {
        const out = await svc.rollback(req.auth!.restaurant_id, req.params.id);
        return envelope(out, null);
      } catch (err) {
        if (err instanceof ReviewBatchNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if (err instanceof ReviewBatchAlreadyProcessedError) {
          return reply.code(409).send(envelope(null, { code: 'ALREADY_PROCESSED', message: err.message }));
        }
        if (err instanceof ReviewRollbackWindowError) {
          return reply.code(409).send(envelope(null, { code: 'ROLLBACK_WINDOW', message: err.message }));
        }
        throw err;
      }
    },
  );
}
