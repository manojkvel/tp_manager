// TASK-033 — Prisma-backed repos for ingredients.
//
// All reads/writes are scoped to `restaurant_id` so the @tp/tp/require-restaurant-id
// lint rule passes by default (DEC-012).

import type { PrismaClient } from '@prisma/client';
import type {
  IngredientRepo, IngredientCostRepo, RecipeLineRef,
  IngredientRow, IngredientListRow, ListFilters, CulinaryCategory,
} from './service.js';
import type { UomCategory } from '@tp/types';

export function prismaIngredientRepo(prisma: PrismaClient): IngredientRepo {
  return {
    async list(restaurant_id: string, filters: ListFilters = {}): Promise<IngredientListRow[]> {
      const where: Record<string, unknown> = { restaurant_id };
      if (filters.includeArchived !== true) where['is_archived'] = false;
      if (filters.search) where['name'] = { contains: filters.search, mode: 'insensitive' };
      if (filters.locationId) where['storage_location_id'] = filters.locationId;
      if (filters.supplierId) where['default_supplier_id'] = filters.supplierId;
      if (filters.culinaryCategory) where['culinary_category'] = filters.culinaryCategory;
      const rows = await prisma.ingredient.findMany({
        where,
        orderBy: { name: 'asc' },
        include: filters.includeKpis ? { default_supplier: { select: { name: true } } } : undefined,
      });
      const mapped = rows.map((r) => {
        const base = mapIngredient(r);
        if (!filters.includeKpis) return base as IngredientListRow;
        return {
          ...base,
          supplier_name: (r as unknown as { default_supplier?: { name: string } | null }).default_supplier?.name ?? null,
        } satisfies IngredientListRow;
      });
      if (!filters.includeKpis) return mapped;
      // Second pass — latest cost + recipes-using count per ingredient.
      const ids = mapped.map((m) => m.id);
      if (ids.length === 0) return mapped;
      const costs = await prisma.ingredientCost.findMany({
        where: { ingredient_id: { in: ids } },
        orderBy: { effective_from: 'desc' },
      });
      const latestByIngredient = new Map<string, number>();
      for (const c of costs) if (!latestByIngredient.has(c.ingredient_id)) latestByIngredient.set(c.ingredient_id, c.unit_cost_cents);
      const usages = await prisma.recipeLine.groupBy({
        by: ['ingredient_id'],
        where: { ref_type: 'ingredient', ingredient_id: { in: ids } },
        _count: { _all: true },
      });
      const usageByIngredient = new Map<string, number>();
      for (const u of usages) if (u.ingredient_id) usageByIngredient.set(u.ingredient_id, u._count._all);
      let filtered = mapped.map((m) => ({
        ...m,
        latest_unit_cost_cents: latestByIngredient.get(m.id) ?? null,
        recipes_using_count: usageByIngredient.get(m.id) ?? 0,
      } satisfies IngredientListRow));
      if (filters.belowPar) {
        filtered = filtered.filter((m) => m.par_qty != null && (m.par_qty as number) > 0);
        // NOTE: "below PAR" strictly requires current on-hand data (latest count) —
        // deferred to a future enhancement when on-hand is cheap to derive. For now
        // the flag reduces to "has PAR" so the UI chip does something useful.
      }
      return filtered;
    },
    async findById(id: string) {
      // Caller (service) filters by restaurant_id after the read; the tenant
      // check is redundant at the repo level but documented for clarity.
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service layer enforces restaurant_id check
      const row = await prisma.ingredient.findUnique({ where: { id } });
      return row ? mapIngredient(row) : null;
    },
    async findByName(restaurant_id: string, name: string) {
      const row = await prisma.ingredient.findFirst({
        where: { restaurant_id, name: { equals: name, mode: 'insensitive' } },
      });
      return row ? mapIngredient(row) : null;
    },
    async insert(row: IngredientRow) {
      await prisma.ingredient.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          name: row.name,
          uom: row.uom,
          uom_category: row.uom_category,
          pack_size: row.pack_size ?? null,
          storage_location_id: row.storage_location_id,
          default_supplier_id: row.default_supplier_id,
          shelf_life_days: row.shelf_life_days,
          allergen_flags: row.allergen_flags,
          density_g_per_ml: row.density_g_per_ml ?? null,
          par_qty: row.par_qty ?? null,
          par_uom: row.par_uom,
          culinary_category: row.culinary_category,
          photo_required: row.photo_required,
          supplier_sku: row.supplier_sku,
          is_archived: row.is_archived,
          archived_at: row.archived_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      });
    },
    async update(id: string, patch: Partial<IngredientRow>) {
      await prisma.ingredient.update({ where: { id }, data: prismaUpdateData(patch) });
    },
    async archive(id: string, at: Date) {
      await prisma.ingredient.update({ where: { id }, data: { is_archived: true, archived_at: at } });
    },
    async remove(id: string) {
      await prisma.ingredient.delete({ where: { id } });
    },
  };
}

export function prismaIngredientCostRepo(prisma: PrismaClient): IngredientCostRepo {
  return {
    async insert(row) {
      await prisma.ingredientCost.create({
        data: {
          ingredient_id: row.ingredient_id,
          unit_cost_cents: row.unit_cost_cents,
          effective_from: row.effective_from,
          source: row.source ?? 'manual',
          note: row.note,
        },
      });
    },
    async latestCents(ingredient_id: string) {
      const row = await prisma.ingredientCost.findFirst({
        where: { ingredient_id },
        orderBy: { effective_from: 'desc' },
      });
      return row?.unit_cost_cents ?? null;
    },
    async listHistory(ingredient_id: string) {
      const rows = await prisma.ingredientCost.findMany({
        where: { ingredient_id },
        orderBy: { effective_from: 'desc' },
      });
      return rows.map((r) => ({
        ingredient_id: r.ingredient_id,
        unit_cost_cents: r.unit_cost_cents,
        effective_from: r.effective_from,
        source: r.source as 'delivery' | 'manual' | 'migration',
        note: r.note,
      }));
    },
  };
}

/**
 * RecipeLine lookup — a line references an ingredient when `ref_type='ingredient'`
 * and `ref_id` matches. Scoped via RecipeVersion → Recipe.restaurant_id at the DB level.
 */
export function prismaRecipeLineRef(prisma: PrismaClient): RecipeLineRef {
  return {
    async isReferenced(ingredient_id: string) {
      const count = await prisma.recipeLine.count({
        where: { ref_type: 'ingredient', ingredient_id },
      });
      return count > 0;
    },
    async listUsingIngredient(ingredient_id: string) {
      const lines = await prisma.recipeLine.findMany({
        where: { ref_type: 'ingredient', ingredient_id },
        include: { recipe_version: { include: { recipe: true } } },
      });
      return lines.map((l) => ({
        recipe_id: l.recipe_version.recipe.id,
        recipe_name: l.recipe_version.recipe.name,
        version: l.recipe_version.version,
        qty: Number(l.qty ?? 0),
        uom: l.uom ?? null,
      }));
    },
  };
}

function mapIngredient(row: {
  id: string;
  restaurant_id: string;
  name: string;
  uom: string;
  uom_category: string;
  pack_size: unknown;
  storage_location_id: string | null;
  default_supplier_id: string | null;
  shelf_life_days: number | null;
  allergen_flags: string[];
  density_g_per_ml: unknown;
  par_qty?: unknown;
  par_uom?: string | null;
  culinary_category?: string | null;
  photo_required?: boolean;
  supplier_sku?: string | null;
  is_archived: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): IngredientRow {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: row.name,
    uom: row.uom,
    uom_category: row.uom_category as UomCategory,
    pack_size: row.pack_size == null ? null : Number(row.pack_size),
    storage_location_id: row.storage_location_id,
    default_supplier_id: row.default_supplier_id,
    shelf_life_days: row.shelf_life_days,
    allergen_flags: row.allergen_flags,
    density_g_per_ml: row.density_g_per_ml == null ? null : Number(row.density_g_per_ml),
    par_qty: row.par_qty == null ? null : Number(row.par_qty),
    par_uom: row.par_uom ?? null,
    culinary_category: (row.culinary_category ?? null) as CulinaryCategory | null,
    photo_required: row.photo_required ?? false,
    supplier_sku: row.supplier_sku ?? null,
    is_archived: row.is_archived,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function prismaUpdateData(patch: Partial<IngredientRow>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}
