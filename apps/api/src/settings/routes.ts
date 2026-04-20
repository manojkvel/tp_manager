// TASK-036 — Settings catalogue HTTP routes (§6.11).
//
// All taxonomy mutations are owner-only (see RBAC matrix in guard.ts).
// Par-level mutations are owner-or-manager (operational).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { ownerOnly, ownerOrManager, anyAuthed } from '../rbac/guard.js';
import {
  DuplicateError, NotFoundError,
  type SettingsServices,
  type LocationKind, type UtensilKind,
} from './service.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

async function guardError(reply: FastifyReply, fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DuplicateError) {
      return reply.code(409).send(envelope(null, { code: 'DUPLICATE', message: err.message }));
    }
    if (err instanceof NotFoundError) {
      return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
    }
    throw err;
  }
}

export async function registerSettingsRoutes(app: FastifyInstance, svc: SettingsServices): Promise<void> {
  // ── Locations ──────────────────────────────────────────────────────────
  app.get<{ Querystring: { includeArchived?: string } }>(
    '/api/v1/settings/locations',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.locations.list(req.auth!.restaurant_id, {
        includeArchived: req.query.includeArchived === 'true',
      });
      return envelope(rows, null);
    },
  );

  app.post<{ Body: { name: string; kind: LocationKind } }>(
    '/api/v1/settings/locations',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      const row = await svc.locations.create(req.auth!.restaurant_id, req.body);
      return reply.code(201).send(envelope(row, null));
    }),
  );

  app.put<{ Params: { id: string }; Body: { name: string } }>(
    '/api/v1/settings/locations/:id',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      const row = await svc.locations.rename(req.auth!.restaurant_id, req.params.id, req.body.name);
      return envelope(row, null);
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/settings/locations/:id/archive',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      await svc.locations.archive(req.auth!.restaurant_id, req.params.id);
      return reply.code(204).send();
    }),
  );

  // ── Utensils + equivalences ────────────────────────────────────────────
  app.get<{ Querystring: { includeArchived?: string } }>(
    '/api/v1/settings/utensils',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.utensils.list(req.auth!.restaurant_id, {
        includeArchived: req.query.includeArchived === 'true',
      });
      return envelope(rows, null);
    },
  );

  app.post<{ Body: { name: string; kind: UtensilKind; default_uom: string; default_qty: number; label_colour?: string | null } }>(
    '/api/v1/settings/utensils',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      const row = await svc.utensils.create(req.auth!.restaurant_id, req.body);
      return reply.code(201).send(envelope(row, null));
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/settings/utensils/:id/archive',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      await svc.utensils.archive(req.auth!.restaurant_id, req.params.id);
      return reply.code(204).send();
    }),
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/settings/utensils/:id/equivalences',
    { preHandler: [anyAuthed()] },
    async (req) => envelope(await svc.utensils.equivalencesFor(req.params.id), null),
  );

  app.post<{ Params: { id: string }; Body: { ingredient_id: string | null; equivalent_qty: number; equivalent_uom: string } }>(
    '/api/v1/settings/utensils/:id/equivalences',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      const row = await svc.utensils.setEquivalence(req.auth!.restaurant_id, req.params.id, req.body);
      return envelope(row, null);
    }),
  );

  // ── Waste reasons ──────────────────────────────────────────────────────
  app.get<{ Querystring: { includeArchived?: string } }>(
    '/api/v1/settings/waste-reasons',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.wasteReasons.list(req.auth!.restaurant_id, {
        includeArchived: req.query.includeArchived === 'true',
      });
      return envelope(rows, null);
    },
  );

  app.post<{ Body: { code: string; label: string } }>(
    '/api/v1/settings/waste-reasons',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      const row = await svc.wasteReasons.create(req.auth!.restaurant_id, req.body);
      return reply.code(201).send(envelope(row, null));
    }),
  );

  app.put<{ Params: { id: string }; Body: { label?: string } }>(
    '/api/v1/settings/waste-reasons/:id',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      const row = await svc.wasteReasons.update(req.auth!.restaurant_id, req.params.id, req.body);
      return envelope(row, null);
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/settings/waste-reasons/:id/archive',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      await svc.wasteReasons.archive(req.auth!.restaurant_id, req.params.id);
      return reply.code(204).send();
    }),
  );

  // ── Kitchen stations ───────────────────────────────────────────────────
  // §6.11 — kitchen stations are an editable per-restaurant catalogue.
  // RecipeLine.station carries the station's `code` as plain text, so renaming
  // or archiving a station never orphans recipe history.
  app.get<{ Querystring: { includeArchived?: string } }>(
    '/api/v1/settings/stations',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.stations.list(req.auth!.restaurant_id, {
        includeArchived: req.query.includeArchived === 'true',
      });
      return envelope(rows, null);
    },
  );

  app.post<{ Body: { code: string; label: string; sort_order?: number } }>(
    '/api/v1/settings/stations',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      try {
        const row = await svc.stations.create(req.auth!.restaurant_id, req.body);
        return reply.code(201).send(envelope(row, null));
      } catch (err) {
        if (err instanceof DuplicateError || err instanceof NotFoundError) throw err;
        return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: (err as Error).message }));
      }
    }),
  );

  app.put<{ Params: { id: string }; Body: { label?: string; sort_order?: number } }>(
    '/api/v1/settings/stations/:id',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      try {
        const row = await svc.stations.update(req.auth!.restaurant_id, req.params.id, req.body);
        return envelope(row, null);
      } catch (err) {
        if (err instanceof DuplicateError || err instanceof NotFoundError) throw err;
        return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: (err as Error).message }));
      }
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/settings/stations/:id/archive',
    { preHandler: [ownerOnly()] },
    async (req, reply) => guardError(reply, async () => {
      await svc.stations.archive(req.auth!.restaurant_id, req.params.id);
      return reply.code(204).send();
    }),
  );

  // ── Par levels ─────────────────────────────────────────────────────────
  app.get<{ Querystring: { recipeId?: string } }>(
    '/api/v1/settings/par-levels',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.parLevels.list(req.auth!.restaurant_id, req.query.recipeId);
      return envelope(rows, null);
    },
  );

  app.put<{ Body: { recipe_id: string; day_of_week: number; qty: number } }>(
    '/api/v1/settings/par-levels',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      try {
        const row = await svc.parLevels.set(req.auth!.restaurant_id, req.body);
        return envelope(row, null);
      } catch (err) {
        return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: (err as Error).message }));
      }
    },
  );
}
