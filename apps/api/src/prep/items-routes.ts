// v1.7 Wave 12 — Prep Items library endpoint.
//
// The Prep Items page in the PO design shows sub-recipes (type='prep') with
// their batch yield, ingredient chips, shelf-life in hours, storage temp, and
// culinary category. Rather than bloat the generic /recipes payload we expose
// a focused list endpoint that joins the current version's fields in one go.

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { anyAuthed } from '../rbac/guard.js';

function envelope<T>(data: T | null, error: { code: string; message: string } | null) {
  return { data, error };
}

export type PrepCategory =
  | 'sauces' | 'mise_en_place' | 'dressings' | 'marinades' | 'stocks'
  | 'doughs_batters' | 'proteins_cooked' | 'vegetables_prepped' | 'other';

export interface PrepItemRow {
  recipe_id: string;
  name: string;
  prep_category: PrepCategory | null;
  is_archived: boolean;
  batch_yield_qty: number | null;
  batch_yield_uom: string | null;
  shelf_life_hours: number | null;
  shelf_life_days: number | null;
  storage_temp_f: number | null;
  ingredients: Array<{ id: string; name: string }>;
  ingredient_overflow: number;
}

const INGREDIENT_CHIP_CAP = 3;

export async function registerPrepItemRoutes(app: FastifyInstance, prisma: PrismaClient): Promise<void> {
  app.get<{ Querystring: { category?: PrepCategory } }>(
    '/api/v1/prep-items',
    { preHandler: [anyAuthed()] },
    async (req) => {
      const restaurantId = req.auth!.restaurant_id;
      const where: Record<string, unknown> = {
        restaurant_id: restaurantId,
        type: 'prep',
        is_archived: false,
      };
      if (req.query.category) where['prep_category'] = req.query.category;

      const recipes = await prisma.recipe.findMany({
        where,
        orderBy: { name: 'asc' },
        include: {
          versions: {
            where: { is_current: true },
            take: 1,
            include: {
              lines: {
                orderBy: { position: 'asc' },
                take: 10,
                include: { ingredient: { select: { id: true, name: true } } },
              },
            },
          },
        },
      });

      const rows: PrepItemRow[] = recipes.map((r) => {
        const v = r.versions[0];
        const lines = v?.lines ?? [];
        const ingredients = lines
          .filter((l) => l.ref_type === 'ingredient' && l.ingredient)
          .map((l) => ({ id: l.ingredient!.id, name: l.ingredient!.name }));
        return {
          recipe_id: r.id,
          name: r.name,
          prep_category: (r.prep_category as PrepCategory | null) ?? null,
          is_archived: r.is_archived,
          batch_yield_qty: v ? Number(v.yield_qty) : null,
          batch_yield_uom: v?.yield_uom ?? null,
          shelf_life_hours: v?.shelf_life_hours ?? null,
          shelf_life_days: v?.shelf_life_days ?? null,
          storage_temp_f: v?.storage_temp_f != null ? Number(v.storage_temp_f) : null,
          ingredients: ingredients.slice(0, INGREDIENT_CHIP_CAP),
          ingredient_overflow: Math.max(0, ingredients.length - INGREDIENT_CHIP_CAP),
        };
      });

      return envelope(rows, null);
    },
  );
}
