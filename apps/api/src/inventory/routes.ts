// TASK-053 — Inventory HTTP routes (§6.5).

import type { FastifyInstance } from 'fastify';
import { anyAuthed } from '../rbac/guard.js';
import {
  InventoryService, InventoryCountNotFoundError, InventoryCountImmutableError, InvalidCountTransitionError,
  type AddLineInput,
} from './service.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export interface InventoryKpiSource {
  /**
   * §6.10 dashboard KPI.
   * `value_cents` — sum(actual_qty × unit_cost_cents) across the most-recent
   * completed count's lines (falls back to ingredient latest cost when the
   * line didn't capture a cost).
   * `items_tracked` — count of non-archived ingredients for the restaurant.
   */
  inventoryKpi(restaurant_id: string): Promise<{ value_cents: number; items_tracked: number }>;
}

function toReplyError(err: unknown): { code: number; body: ReturnType<typeof envelope> } | null {
  if (err instanceof InventoryCountNotFoundError) {
    return { code: 404, body: envelope(null, { code: 'NOT_FOUND', message: err.message }) };
  }
  if (err instanceof InventoryCountImmutableError) {
    return { code: 409, body: envelope(null, { code: 'IMMUTABLE', message: err.message }) };
  }
  if (err instanceof InvalidCountTransitionError) {
    return { code: 409, body: envelope(null, { code: 'INVALID_TRANSITION', message: err.message }) };
  }
  return null;
}

export async function registerInventoryRoutes(
  app: FastifyInstance,
  svc: InventoryService,
  kpi?: InventoryKpiSource,
): Promise<void> {
  if (kpi) {
    app.get(
      '/api/v1/inventory/kpi',
      { preHandler: [anyAuthed()] },
      async (req) => envelope(await kpi.inventoryKpi(req.auth!.restaurant_id), null),
    );
  }

  app.post<{ Body: { date?: string } }>(
    '/api/v1/inventory/counts',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      const date = req.body?.date ? new Date(req.body.date) : new Date();
      const c = await svc.start(req.auth!.restaurant_id, date, req.auth!.sub);
      return reply.code(201).send(envelope(c, null));
    },
  );

  // v1.7 §6.5 — always-open today's count. Starts one on demand if none exists.
  app.get(
    '/api/v1/inventory/counts/today',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const c = await svc.getOrStartToday(req.auth!.restaurant_id, req.auth!.sub);
      const lines = await svc.linesFor(c.id);
      return envelope({ count: c, lines }, null);
    },
  );

  // v1.7 §6.5 — persist GPS coords captured on first interaction.
  app.post<{ Params: { id: string }; Body: { lat: number; lng: number } }>(
    '/api/v1/inventory/counts/:id/gps',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        await svc.setGps(req.auth!.restaurant_id, req.params.id, req.body.lat, req.body.lng);
        return reply.code(204).send();
      } catch (err) {
        const mapped = toReplyError(err);
        if (mapped) return reply.code(mapped.code).send(mapped.body);
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/inventory/counts/:id',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const c = await svc.get(req.auth!.restaurant_id, req.params.id);
        const lines = await svc.linesFor(c.id);
        return envelope({ count: c, lines }, null);
      } catch (err) {
        const mapped = toReplyError(err);
        if (mapped) return reply.code(mapped.code).send(mapped.body);
        throw err;
      }
    },
  );

  for (const [path, action] of [
    ['pause', 'pause'],
    ['resume', 'resume'],
  ] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/v1/inventory/counts/:id/${path}`,
      { preHandler: [anyAuthed()] },
      async (req, reply) => {
        try {
          await svc[action](req.auth!.restaurant_id, req.params.id);
          return reply.code(204).send();
        } catch (err) {
          const mapped = toReplyError(err);
          if (mapped) return reply.code(mapped.code).send(mapped.body);
          throw err;
        }
      },
    );
  }

  app.post<{ Params: { id: string }; Body: { completed_by?: string | null } }>(
    '/api/v1/inventory/counts/:id/complete',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        await svc.complete(req.auth!.restaurant_id, req.params.id, req.body?.completed_by ?? req.auth!.sub);
        return reply.code(204).send();
      } catch (err) {
        const mapped = toReplyError(err);
        if (mapped) return reply.code(mapped.code).send(mapped.body);
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: AddLineInput }>(
    '/api/v1/inventory/counts/:id/lines',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const line = await svc.addLine(req.auth!.restaurant_id, req.params.id, req.body);
        return reply.code(201).send(envelope(line, null));
      } catch (err) {
        const mapped = toReplyError(err);
        if (mapped) return reply.code(mapped.code).send(mapped.body);
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/inventory/counts/:id/amend',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const next = await svc.amend(req.auth!.restaurant_id, req.params.id, req.auth!.sub);
        return reply.code(201).send(envelope(next, null));
      } catch (err) {
        const mapped = toReplyError(err);
        if (mapped) return reply.code(mapped.code).send(mapped.body);
        throw err;
      }
    },
  );
}
