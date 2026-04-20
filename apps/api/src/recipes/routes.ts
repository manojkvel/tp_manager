// TASK-040/041/042 — Recipes HTTP routes (§6.3, §6.3a, §6.3b).
//
// Envelope: `{ data, error }`.
// RBAC: list/get/station/cost → any authed; create/appendVersion/archive → owner or manager.

import type { FastifyInstance } from 'fastify';
import { ownerOrManager, anyAuthed } from '../rbac/guard.js';
import { RecipesService, DuplicateRecipeError, RecipeNotFoundError, type CreateRecipeInput, type NewVersionInput } from './service.js';
import { ConversionError } from '@tp/conversions';
import { renderRecipeCard, renderStationSheet, type PrintableRecipe } from './printable.js';

interface CreateBody extends CreateRecipeInput {}
interface NewVersionBody extends Omit<NewVersionInput, 'recipe_id'> {}

/** GAP-02 — resolves ingredient_id / ref_recipe_id → human-readable name for the printable card. */
export type LabelLookup = (restaurant_id: string, ids: { ingredient_ids: string[]; recipe_ids: string[] }) => Promise<Record<string, string>>;

export interface RecipeRouteDeps {
  /** Optional — when omitted, printable cards fall back to ids/notes. */
  labels?: LabelLookup;
}

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export async function registerRecipeRoutes(app: FastifyInstance, svc: RecipesService, deps: RecipeRouteDeps = {}): Promise<void> {
  app.get<{ Querystring: { search?: string; type?: 'prep' | 'menu'; station?: string; includeArchived?: string } }>(
    '/api/v1/recipes',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.list(req.auth!.restaurant_id, {
        search: req.query.search,
        type: req.query.type,
        includeArchived: req.query.includeArchived === 'true',
      });
      return envelope(rows, null);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/recipes/:id',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      const row = await svc.get(req.auth!.restaurant_id, req.params.id);
      if (!row) return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: 'recipe not found' }));
      const versions = await svc.versions(row.id);
      return envelope({ recipe: row, versions }, null);
    },
  );

  app.post<{ Body: CreateBody }>(
    '/api/v1/recipes',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      try {
        const out = await svc.create(req.auth!.restaurant_id, req.body);
        return reply.code(201).send(envelope(out, null));
      } catch (err) {
        if (err instanceof DuplicateRecipeError) {
          return reply.code(409).send(envelope(null, { code: 'DUPLICATE', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Body: NewVersionBody; Params: { id: string } }>(
    '/api/v1/recipes/:id/versions',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      try {
        const out = await svc.appendVersion(req.auth!.restaurant_id, { ...req.body, recipe_id: req.params.id });
        return reply.code(201).send(envelope(out, null));
      } catch (err) {
        if (err instanceof RecipeNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if ((err as Error).name === 'RecipeCycleError') {
          return reply.code(409).send(envelope(null, { code: 'CYCLE', message: (err as Error).message }));
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/recipes/:id/archive',
    { preHandler: [ownerOrManager()] },
    async (req, reply) => {
      try {
        await svc.archive(req.auth!.restaurant_id, req.params.id);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof RecipeNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/recipes/:id/cost',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const result = await svc.platedCost(req.auth!.restaurant_id, req.params.id);
        return envelope(result, null);
      } catch (err) {
        if (err instanceof RecipeNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if ((err as Error).name === 'RecipeCycleError') {
          return reply.code(409).send(envelope(null, { code: 'CYCLE', message: (err as Error).message }));
        }
        if (err instanceof ConversionError) {
          return reply.code(422).send(envelope(null, { code: 'CONVERSION', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { version_id: string } }>(
    '/api/v1/recipe-versions/:version_id/cost',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      try {
        const result = await svc.platedCostForVersion(req.auth!.restaurant_id, req.params.version_id);
        return envelope(result, null);
      } catch (err) {
        if (err instanceof RecipeNotFoundError) {
          return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: err.message }));
        }
        if ((err as Error).name === 'RecipeCycleError') {
          return reply.code(409).send(envelope(null, { code: 'CYCLE', message: (err as Error).message }));
        }
        if (err instanceof ConversionError) {
          return reply.code(422).send(envelope(null, { code: 'CONVERSION', message: err.message }));
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { station: string } }>(
    '/api/v1/recipes/station/:station',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const rows = await svc.stationView(req.auth!.restaurant_id, req.params.station);
      return envelope(rows, null);
    },
  );

  // GAP-02 / §6.3 AC-6 — print-ready flash card. Returns text/html with
  // @media print CSS so the browser saves to PDF via Ctrl+P.
  app.get<{ Params: { id: string } }>(
    '/api/v1/recipes/:id/pdf',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      const recipe = await svc.get(req.auth!.restaurant_id, req.params.id);
      if (!recipe) return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: 'recipe not found' }));
      const versions = await svc.versions(recipe.id);
      const current = versions.find((v) => v.version.is_current) ?? versions[versions.length - 1];
      if (!current) return reply.code(404).send(envelope(null, { code: 'NOT_FOUND', message: 'recipe has no version' }));

      const ingredient_ids = current.lines.filter((l) => l.ref_type === 'ingredient' && l.ingredient_id).map((l) => l.ingredient_id!);
      const recipe_ids = current.lines.filter((l) => l.ref_type === 'recipe' && l.ref_recipe_id).map((l) => l.ref_recipe_id!);
      const labels = deps.labels ? await deps.labels(req.auth!.restaurant_id, { ingredient_ids, recipe_ids }) : {};

      const printable: PrintableRecipe = {
        id: recipe.id,
        name: recipe.name,
        type: recipe.type,
        version: {
          id: current.version.id,
          yield_qty: current.version.yield_qty,
          yield_uom: current.version.yield_uom,
          shelf_life_days: current.version.shelf_life_days,
          equipment: current.version.equipment,
          procedure: current.version.procedure,
          photo_url: current.version.photo_url,
        },
        lines: current.lines,
        ingredient_labels: labels,
      };
      const html = renderRecipeCard(printable);
      const safeName = recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recipe';
      reply.header('Content-Disposition', `inline; filename="${safeName}.html"`);
      return reply.type('text/html; charset=utf-8').send(html);
    },
  );

  // GAP-02 / §6.3b AC-3 — print-ready 4-up station cheat sheet.
  app.get<{ Params: { station: string } }>(
    '/api/v1/recipes/station/:station/pdf',
    { preHandler: [anyAuthed()] },
    async (req, reply) => {
      const rows = await svc.stationView(req.auth!.restaurant_id, req.params.station);
      const html = renderStationSheet(req.params.station, rows);
      const safeStation = req.params.station.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'station';
      reply.header('Content-Disposition', `inline; filename="${safeStation}-station.html"`);
      return reply.type('text/html; charset=utf-8').send(html);
    },
  );
}
