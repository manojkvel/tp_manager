// TASK-040/041 — Prisma-backed repos for recipes + versions + cost context.
//
// All queries are tenant-scoped (DEC-012).

import type { PrismaClient } from '@prisma/client';
import type { UtensilEquivalence } from '@tp/conversions';
import type {
  RecipeRepo, RecipeVersionRepo, RecipeRow, RecipeVersionFull, RecipeType, ListFilters,
} from './service.js';
import type { CostContext, RecipeLineRow, IngredientRef } from './cost.js';

export function prismaRecipeRepo(prisma: PrismaClient): RecipeRepo {
  return {
    async list(restaurant_id, filters: ListFilters = {}) {
      const where: Record<string, unknown> = { restaurant_id };
      if (filters.includeArchived !== true) where['is_archived'] = false;
      if (filters.type) where['type'] = filters.type;
      if (filters.search) where['name'] = { contains: filters.search, mode: 'insensitive' };
      const rows = await prisma.recipe.findMany({ where, orderBy: { name: 'asc' } });
      return rows.map(mapRecipe);
    },
    async findById(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- service layer enforces tenant check
      const row = await prisma.recipe.findUnique({ where: { id } });
      return row ? mapRecipe(row) : null;
    },
    async findByName(restaurant_id, type, name) {
      const row = await prisma.recipe.findFirst({
        where: { restaurant_id, type, name },
      });
      return row ? mapRecipe(row) : null;
    },
    async insert(row) {
      await prisma.recipe.create({
        data: {
          id: row.id,
          restaurant_id: row.restaurant_id,
          type: row.type,
          name: row.name,
          is_archived: row.is_archived,
          created_at: row.created_at,
        },
      });
    },
    async archive(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- mutation by primary key after tenant check
      await prisma.recipe.update({ where: { id }, data: { is_archived: true } });
    },
  };
}

export function prismaRecipeVersionRepo(prisma: PrismaClient): RecipeVersionRepo {
  // `ref_recipe_id` has no Prisma relation on RecipeLine, so we resolve
  // sub-recipe names in one batched lookup after the version query.
  async function resolveSubRecipeNames(refIds: Array<string | null>): Promise<Map<string, string>> {
    const unique = Array.from(new Set(refIds.filter((x): x is string => !!x)));
    if (unique.length === 0) return new Map();
    // eslint-disable-next-line @tp/tp/require-restaurant-id -- PK lookup; caller has already tenant-scoped via recipe_id FK
    const rows = await prisma.recipe.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  return {
    async current(recipe_id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via recipe_id FK
      const v = await prisma.recipeVersion.findFirst({
        where: { recipe_id, is_current: true },
        include: {
          lines: {
            orderBy: { position: 'asc' },
            include: { ingredient: { select: { name: true } } },
          },
        },
      });
      if (!v) return null;
      const subNames = await resolveSubRecipeNames(v.lines.map((l) => l.ref_recipe_id));
      return mapVersion(v, subNames);
    },
    async byId(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via recipe_id FK
      const v = await prisma.recipeVersion.findUnique({
        where: { id },
        include: {
          lines: {
            orderBy: { position: 'asc' },
            include: { ingredient: { select: { name: true } } },
          },
        },
      });
      if (!v) return null;
      const subNames = await resolveSubRecipeNames(v.lines.map((l) => l.ref_recipe_id));
      return mapVersion(v, subNames);
    },
    async list(recipe_id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via recipe_id FK
      const vs = await prisma.recipeVersion.findMany({
        where: { recipe_id },
        orderBy: { version: 'asc' },
        include: {
          lines: {
            orderBy: { position: 'asc' },
            include: { ingredient: { select: { name: true } } },
          },
        },
      });
      const subNames = await resolveSubRecipeNames(vs.flatMap((v) => v.lines.map((l) => l.ref_recipe_id)));
      return vs.map((v) => mapVersion(v, subNames));
    },
    async appendAndPromote(full) {
      await prisma.$transaction(async (tx) => {
        // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via recipe_id FK
        await tx.recipeVersion.updateMany({
          where: { recipe_id: full.version.recipe_id, is_current: true },
          data: { is_current: false },
        });
        await tx.recipeVersion.create({
          data: {
            id: full.version.id,
            recipe_id: full.version.recipe_id,
            version: full.version.version,
            is_current: true,
            yield_qty: full.version.yield_qty,
            yield_uom: full.version.yield_uom,
            shelf_life_days: full.version.shelf_life_days,
            equipment: full.version.equipment,
            procedure: full.version.procedure,
            photo_url: full.version.photo_url,
            is_portion_bag_prep: full.version.is_portion_bag_prep,
            portion_bag_content_json: (full.version.portion_bag_content_json ?? null) as never,
            created_by_user_id: full.version.created_by_user_id,
            created_at: full.version.created_at,
          },
        });
        if (full.lines.length > 0) {
          await tx.recipeLine.createMany({
            data: full.lines.map((l) => ({
              id: l.id,
              recipe_version_id: l.recipe_version_id,
              position: l.position,
              ref_type: l.ref_type,
              ingredient_id: l.ingredient_id,
              ref_recipe_id: l.ref_recipe_id,
              qty: l.qty,
              qty_text: l.qty_text,
              uom: l.uom,
              note: l.note,
              station: l.station as never,
              step_order: l.step_order,
              utensil_id: l.utensil_id,
            })),
          });
        }
      });
    },
  };
}

export function prismaCostContext(prisma: PrismaClient): CostContext {
  return {
    async resolveVersion(recipe_id) {
      return prismaRecipeVersionRepo(prisma).current(recipe_id)
        .then((v) => v ? { version: v.version, lines: v.lines } : null);
    },
    async ingredient(id): Promise<IngredientRef | null> {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- FK lookup by PK after tenant check upstream
      const row = await prisma.ingredient.findUnique({
        where: { id },
        select: { id: true, uom: true, density_g_per_ml: true },
      });
      if (!row) return null;
      return {
        id: row.id,
        uom: row.uom,
        density_g_per_ml: row.density_g_per_ml == null ? null : Number(row.density_g_per_ml),
      };
    },
    async ingredientCost(id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via ingredient_id FK
      const cost = await prisma.ingredientCost.findFirst({
        where: { ingredient_id: id },
        orderBy: { effective_from: 'desc' },
        select: { unit_cost_cents: true },
      });
      return cost?.unit_cost_cents ?? null;
    },
    async utensilEquivalences(utensil_id) {
      // eslint-disable-next-line @tp/tp/require-restaurant-id -- scoped via utensil_id FK
      const rows = await prisma.utensilEquivalence.findMany({ where: { utensil_id } });
      return rows.map<UtensilEquivalence>((r) => ({
        utensilId: r.utensil_id,
        ingredientId: r.ingredient_id,
        equivalentQty: Number(r.equivalent_qty),
        equivalentUom: r.equivalent_uom,
        source: r.source as 'default' | 'override',
      }));
    },
  };
}

function mapRecipe(row: { id: string; restaurant_id: string; type: string; name: string; is_archived: boolean; created_at: Date }): RecipeRow {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    type: row.type as RecipeType,
    name: row.name,
    is_archived: row.is_archived,
    created_at: row.created_at,
  };
}

function mapVersion(v: {
  id: string; recipe_id: string; version: number; is_current: boolean;
  yield_qty: unknown; yield_uom: string;
  shelf_life_days: number | null; equipment: string[]; procedure: string;
  photo_url: string | null; is_portion_bag_prep: boolean;
  portion_bag_content_json: unknown; created_by_user_id: string | null; created_at: Date;
  lines: Array<{
    id: string; recipe_version_id: string; position: number;
    ref_type: string; ingredient_id: string | null; ref_recipe_id: string | null;
    qty: unknown; qty_text: string | null; uom: string | null; note: string | null;
    station: string | null; step_order: number | null; utensil_id: string | null;
    ingredient?: { name: string } | null;
  }>;
}, subRecipeNames: Map<string, string> = new Map()): RecipeVersionFull {
  return {
    version: {
      id: v.id,
      recipe_id: v.recipe_id,
      version: v.version,
      is_current: v.is_current,
      yield_qty: Number(v.yield_qty),
      yield_uom: v.yield_uom,
      shelf_life_days: v.shelf_life_days,
      equipment: v.equipment,
      procedure: v.procedure,
      photo_url: v.photo_url,
      is_portion_bag_prep: v.is_portion_bag_prep,
      portion_bag_content_json: v.portion_bag_content_json,
      created_by_user_id: v.created_by_user_id,
      created_at: v.created_at,
    },
    lines: v.lines.map<RecipeLineRow>((l) => ({
      id: l.id,
      recipe_version_id: l.recipe_version_id,
      position: l.position,
      ref_type: l.ref_type as 'ingredient' | 'recipe',
      ingredient_id: l.ingredient_id,
      ref_recipe_id: l.ref_recipe_id,
      qty: Number(l.qty),
      qty_text: l.qty_text,
      uom: l.uom,
      note: l.note,
      station: l.station,
      step_order: l.step_order,
      utensil_id: l.utensil_id,
      ref_name: l.ref_type === 'ingredient'
        ? (l.ingredient?.name ?? null)
        : (l.ref_recipe_id ? subRecipeNames.get(l.ref_recipe_id) ?? null : null),
    })),
  };
}
