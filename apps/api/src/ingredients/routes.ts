// TASK-033 — Ingredients HTTP routes (§6.1).
//
// All routes require an authenticated user (via the auth plugin). RBAC:
//   - list / get              — any authed role
//   - create / update / cost  — owner or manager
//   - archive / delete        — owner or manager
//   - CSV import              — owner only (bulk write impact)
//   - CSV export              — any authed role
//
// Envelope: `{ data, error }` from CLAUDE.md.

import type { FastifyInstance } from 'fastify';
import { ownerOnly, ownerOrManager, anyAuthed } from '../rbac/guard.js';
import { IngredientsService, DuplicateIngredientError, IngredientInUseError, type CreateIngredientInput, type UpdateIngredientInput, type CulinaryCategory } from './service.js';
import { ingredientsToCsv, csvToIngredients } from './csv.js';

interface CreateBody extends CreateIngredientInput {}
interface UpdateBody extends UpdateIngredientInput {}
interface CostBody { unit_cost_cents: number; effective_from?: string; source?: 'delivery' | 'manual' | 'migration'; note?: string }
interface CsvBody { csv: string }

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export async function registerIngredientRoutes(app: FastifyInstance, svc: IngredientsService): Promise<void> {
  app.get<{ Querystring: {
    search?: string; locationId?: string; supplierId?: string; includeArchived?: string;
    culinary_category?: string; below_par?: string; include_kpis?: string;
  } }>(
    '/api/v1/ingredients',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rid = req.auth!.restaurant_id;
      const { search, locationId, supplierId, includeArchived, culinary_category, below_par, include_kpis } = req.query;
      const rows = await svc.list(rid, {
        search,
        locationId,
        supplierId,
        includeArchived: includeArchived === 'true',
        culinaryCategory: (culinary_category as CulinaryCategory | undefined) || undefined,
        belowPar: below_par === 'true',
        includeKpis: include_kpis === 'true',
      });
      return envelope(rows, null);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/ingredients/:id',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      const row = await svc.get(req.auth!.restaurant_id, req.params.id);
      if (!row) return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: 'ingredient not found' }));
      return envelope(row, null);
    },
  );

  app.post<{ Body: CreateBody }>(
    '/api/v1/ingredients',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      try {
        const row = await svc.create(req.auth!.restaurant_id, req.body);
        return reply.code(201).send(envelope(row, null));
      } catch (err) {
        if (err instanceof DuplicateIngredientError) {
          return reply.code(409).send(envelope(null, { code: 'DUPLICATE', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.put<{ Body: UpdateBody; Params: { id: string } }>(
    '/api/v1/ingredients/:id',
    { preHandler: [ownerOrManager()] },
    async (req) => {
      const row = await svc.update(req.auth!.restaurant_id, req.params.id, req.body);
      return envelope(row, null);
    },
  );

  app.post<{ Body: CostBody; Params: { id: string } }>(
    '/api/v1/ingredients/:id/cost',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      await svc.setCost(req.auth!.restaurant_id, req.params.id, {
        unit_cost_cents: req.body.unit_cost_cents,
        effective_from: req.body.effective_from ? new Date(req.body.effective_from) : undefined,
        source: req.body.source,
        note: req.body.note,
      });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/ingredients/:id/cost-history',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.costHistory(req.auth!.restaurant_id, req.params.id);
      const latest_cents = await svc.latestCostCents(req.auth!.restaurant_id, req.params.id);
      return envelope({ latest_cents, history: rows }, null);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/ingredients/:id/recipes',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.recipesUsing(req.auth!.restaurant_id, req.params.id);
      return envelope(rows, null);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/ingredients/:id/archive',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      await svc.archive(req.auth!.restaurant_id, req.params.id);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/ingredients/:id',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      try {
        await svc.remove(req.auth!.restaurant_id, req.params.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof IngredientInUseError) {
          return reply.code(409).send(envelope(null, { code: 'IN_USE', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/v1/ingredients.csv',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      const rows = await svc.list(req.auth!.restaurant_id, { includeArchived: true });
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="ingredients.csv"');
      return ingredientsToCsv(rows);
    },
  );

  app.post<{ Body: CsvBody }>(
    '/api/v1/ingredients/import',
    { preHandler: [ownerOnly()] },
    async (req, reply) => {
      if (!req.body?.csv) {
        return reply.code(400).send(envelope(null, { code: 'INVALID_REQUEST', message: 'csv body required' }));
      }
      let parsed;
      try {
        parsed = csvToIngredients(req.body.csv);
      } catch (err) {
        return reply.code(400).send(envelope(null, { code: 'INVALID_CSV', message: (err as Error).message }));
      }
      const created: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      for (const row of parsed) {
        try {
          const r = await svc.create(req.auth!.restaurant_id, row);
          created.push(r.id);
        } catch (err) {
          skipped.push({ name: row.name, reason: (err as Error).message });
        }
      }
      return envelope({ created, skipped }, null);
    },
  );
}
