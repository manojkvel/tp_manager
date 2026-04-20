// TASK-059 — Orders HTTP routes (§6.7).

import type { FastifyInstance } from 'fastify';
import { anyAuthed, ownerOrManager } from '../rbac/guard.js';
import {
  OrdersService, OrderNotFoundError, InvalidOrderTransitionError,
  type CreateDraftInput,
} from './service.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export async function registerOrderRoutes(app: FastifyInstance, svc: OrdersService): Promise<void> {
  app.get('/api/v1/orders/suggestions', { preHandler: [anyAuthed()] }, async (req) => {
    const list = await svc.suggest(req.auth!.restaurant_id);
    return envelope(list, null);
  });

  app.get<{ Querystring: { status?: 'draft' | 'sent' | 'received' } }>(
    '/api/v1/orders',
    { preHandler: [anyAuthed()] },
    async (req) => envelope(await svc.list(req.auth!.restaurant_id, req.query.status), null),
  );

  app.post<{ Body: CreateDraftInput }>(
    '/api/v1/orders',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      const o = await svc.createDraft(req.auth!.restaurant_id, req.body);
      return reply.code(201).send(envelope(o, null));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const o = await svc.get(req.auth!.restaurant_id, req.params.id);
        const lines = await svc.linesFor(o.id);
        return envelope({ order: o, lines }, null);
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id/export.csv',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const o = await svc.get(req.auth!.restaurant_id, req.params.id);
        const lines = await svc.linesFor(o.id);
        reply.header('content-type', 'text/csv');
        return OrdersService.toCsv(o, lines);
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  for (const action of ['send', 'receive'] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/v1/orders/:id/${action}`,
      { preHandler: [ownerOrManager()] },
      async (req, reply) => {
        try {
          const o = action === 'send'
            ? await svc.send(req.auth!.restaurant_id, req.params.id)
            : await svc.markReceived(req.auth!.restaurant_id, req.params.id);
          return envelope(o, null);
        } catch (err) {
          if (err instanceof OrderNotFoundError) {
            return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
          }
          if (err instanceof InvalidOrderTransitionError) {
            return reply.code(409).send(envelope(null, { code: 'INVALID_TRANSITION', message: err.message }));
          }
          throw err;
        }
      },
    );
  }
}
