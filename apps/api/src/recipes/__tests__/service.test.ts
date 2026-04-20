// TASK-038/041 — RecipesService unit tests (DB-free, in-memory repos).

import { beforeEach, describe, it, expect } from 'vitest';
import {
  RecipesService, DuplicateRecipeError, RecipeNotFoundError,
  type RecipeRepo, type RecipeVersionRepo, type RecipeRow, type RecipeVersionFull,
} from '../service.js';
import type { CostContext, IngredientRef } from '../cost.js';

const RID = '00000000-0000-0000-0000-0000000000aa';

function inMemory() {
  const recipes = new Map<string, RecipeRow>();
  const versions = new Map<string, RecipeVersionFull>();
  const byRecipe = new Map<string, RecipeVersionFull[]>();

  const recipeRepo: RecipeRepo = {
    async list(rid, filters) {
      return [...recipes.values()].filter((r) => {
        if (r.restaurant_id !== rid) return false;
        if (!filters?.includeArchived && r.is_archived) return false;
        if (filters?.type && r.type !== filters.type) return false;
        if (filters?.search && !r.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
        return true;
      });
    },
    async findById(id) { return recipes.get(id) ?? null; },
    async findByName(rid, type, name) {
      for (const r of recipes.values()) {
        if (r.restaurant_id === rid && r.type === type && r.name === name) return r;
      }
      return null;
    },
    async insert(row) { recipes.set(row.id, row); },
    async archive(id) {
      const r = recipes.get(id);
      if (r) recipes.set(id, { ...r, is_archived: true });
    },
  };

  const versionRepo: RecipeVersionRepo = {
    async current(recipe_id) {
      const list = byRecipe.get(recipe_id) ?? [];
      return list.find((v) => v.version.is_current) ?? null;
    },
    async byId(id) { return versions.get(id) ?? null; },
    async list(recipe_id) { return byRecipe.get(recipe_id) ?? []; },
    async appendAndPromote(full) {
      const list = byRecipe.get(full.version.recipe_id) ?? [];
      for (const v of list) {
        v.version = { ...v.version, is_current: false };
        versions.set(v.version.id, v);
      }
      list.push(full);
      byRecipe.set(full.version.recipe_id, list);
      versions.set(full.version.id, full);
    },
  };

  return { recipeRepo, versionRepo, _state: { recipes, versions, byRecipe } };
}

function costCtx(opts: {
  ingredients?: Map<string, IngredientRef>;
  costs?: Map<string, number>;
} = {}): CostContext {
  return {
    async resolveVersion() { return null; },
    async ingredient(id) { return opts.ingredients?.get(id) ?? null; },
    async ingredientCost(id) { return opts.costs?.get(id) ?? null; },
    async utensilEquivalences() { return []; },
  };
}

describe('RecipesService.create', () => {
  let svc: RecipesService;
  let mem: ReturnType<typeof inMemory>;

  beforeEach(() => {
    mem = inMemory();
    svc = new RecipesService({
      recipes: mem.recipeRepo,
      versions: mem.versionRepo,
      costs: costCtx(),
    });
  });

  it('creates a recipe and its v1 version in one shot', async () => {
    const { recipe, version } = await svc.create(RID, {
      type: 'menu', name: 'Omelette',
      initial_version: {
        yield_qty: 1, yield_uom: 'each',
        lines: [
          { position: 0, ref_type: 'ingredient', ingredient_id: 'egg', ref_recipe_id: null,
            qty: 3, qty_text: null, uom: 'each', note: null, station: 'egg', step_order: 1, utensil_id: null },
        ],
      },
    });
    expect(recipe.name).toBe('Omelette');
    expect(version.version.version).toBe(1);
    expect(version.version.is_current).toBe(true);
    expect(version.lines).toHaveLength(1);
  });

  it('rejects duplicate (restaurant_id, type, name)', async () => {
    await svc.create(RID, { type: 'menu', name: 'Omelette', initial_version: { yield_qty: 1, yield_uom: 'each', lines: [] } });
    await expect(svc.create(RID, { type: 'menu', name: 'Omelette', initial_version: { yield_qty: 1, yield_uom: 'each', lines: [] } }))
      .rejects.toThrow(DuplicateRecipeError);
  });

  it('allows same name across prep and menu types', async () => {
    await svc.create(RID, { type: 'menu', name: 'Salsa', initial_version: { yield_qty: 1, yield_uom: 'each', lines: [] } });
    await expect(svc.create(RID, { type: 'prep', name: 'Salsa', initial_version: { yield_qty: 1, yield_uom: 'L', lines: [] } }))
      .resolves.toBeDefined();
  });
});

describe('RecipesService.appendVersion (§6.3 AC-5, DEC-014)', () => {
  it('appends v2 and marks v1 as not-current', async () => {
    const mem = inMemory();
    const svc = new RecipesService({ recipes: mem.recipeRepo, versions: mem.versionRepo, costs: costCtx() });
    const { recipe } = await svc.create(RID, {
      type: 'menu', name: 'Omelette',
      initial_version: { yield_qty: 1, yield_uom: 'each', lines: [] },
    });
    await svc.appendVersion(RID, { recipe_id: recipe.id, yield_qty: 1, yield_uom: 'each', lines: [] });
    const versions = await svc.versions(recipe.id);
    expect(versions).toHaveLength(2);
    const currents = versions.filter((v) => v.version.is_current);
    expect(currents).toHaveLength(1);
    expect(currents[0]!.version.version).toBe(2);
  });

  it('rejects version append that creates a cycle (A → B → A)', async () => {
    const mem = inMemory();
    const svc = new RecipesService({ recipes: mem.recipeRepo, versions: mem.versionRepo, costs: costCtx() });
    const a = await svc.create(RID, {
      type: 'prep', name: 'A',
      initial_version: { yield_qty: 1, yield_uom: 'each', lines: [] },
    });
    const b = await svc.create(RID, {
      type: 'prep', name: 'B',
      initial_version: {
        yield_qty: 1, yield_uom: 'each',
        lines: [{ position: 0, ref_type: 'recipe', ingredient_id: null, ref_recipe_id: a.recipe.id,
          qty: 1, qty_text: null, uom: 'each', note: null, station: null, step_order: null, utensil_id: null }],
      },
    });
    await expect(svc.appendVersion(RID, {
      recipe_id: a.recipe.id, yield_qty: 1, yield_uom: 'each',
      lines: [{ position: 0, ref_type: 'recipe', ingredient_id: null, ref_recipe_id: b.recipe.id,
        qty: 1, qty_text: null, uom: 'each', note: null, station: null, step_order: null, utensil_id: null }],
    })).rejects.toThrow(/cycle/);
  });
});

describe('RecipesService.platedCost — wires cost context through to the pure calc', () => {
  it('computes cost for the current version', async () => {
    const mem = inMemory();
    const svc = new RecipesService({
      recipes: mem.recipeRepo,
      versions: mem.versionRepo,
      costs: costCtx({
        ingredients: new Map([['egg', { id: 'egg', uom: 'each', density_g_per_ml: null }]]),
        costs: new Map([['egg', 25]]), // 25¢/each
      }),
    });
    const { recipe } = await svc.create(RID, {
      type: 'menu', name: 'Omelette',
      initial_version: { yield_qty: 1, yield_uom: 'each', lines: [
        { position: 0, ref_type: 'ingredient', ingredient_id: 'egg', ref_recipe_id: null,
          qty: 3, qty_text: null, uom: 'each', note: null, station: 'egg', step_order: 1, utensil_id: null },
      ] },
    });
    const cost = await svc.platedCost(RID, recipe.id);
    expect(cost.total_cents).toBe(75);
  });
});

describe('RecipesService.stationView', () => {
  it('returns only menu lines with the requested station', async () => {
    const mem = inMemory();
    const svc = new RecipesService({ recipes: mem.recipeRepo, versions: mem.versionRepo, costs: costCtx() });
    await svc.create(RID, {
      type: 'menu', name: 'Omelette',
      initial_version: { yield_qty: 1, yield_uom: 'each', lines: [
        { position: 0, ref_type: 'ingredient', ingredient_id: 'egg', ref_recipe_id: null,
          qty: 3, qty_text: null, uom: 'each', note: null, station: 'egg', step_order: 1, utensil_id: null },
        { position: 1, ref_type: 'ingredient', ingredient_id: 'egg', ref_recipe_id: null,
          qty: 0, qty_text: null, uom: null, note: 'plate', station: 'expo', step_order: 2, utensil_id: null },
      ] },
    });
    const view = await svc.stationView(RID, 'egg');
    expect(view).toHaveLength(1);
    expect(view[0]!.line.station).toBe('egg');
  });
});

describe('RecipesService.platedCostForVersion — tenant isolation (DEC-012)', () => {
  const OTHER_RID = '00000000-0000-0000-0000-0000000000bb';

  it('returns cost for a version owned by the caller', async () => {
    const mem = inMemory();
    const svc = new RecipesService({
      recipes: mem.recipeRepo,
      versions: mem.versionRepo,
      costs: costCtx({
        ingredients: new Map([['egg', { id: 'egg', uom: 'each', density_g_per_ml: null }]]),
        costs: new Map([['egg', 25]]),
      }),
    });
    const { version } = await svc.create(RID, {
      type: 'menu', name: 'Omelette',
      initial_version: { yield_qty: 1, yield_uom: 'each', lines: [
        { position: 0, ref_type: 'ingredient', ingredient_id: 'egg', ref_recipe_id: null,
          qty: 3, qty_text: null, uom: 'each', note: null, station: 'egg', step_order: 1, utensil_id: null },
      ] },
    });
    const cost = await svc.platedCostForVersion(RID, version.version.id);
    expect(cost.total_cents).toBe(75);
  });

  it('throws RecipeNotFoundError when the caller is a different tenant', async () => {
    const mem = inMemory();
    const svc = new RecipesService({ recipes: mem.recipeRepo, versions: mem.versionRepo, costs: costCtx() });
    const { version } = await svc.create(RID, {
      type: 'menu', name: 'Omelette',
      initial_version: { yield_qty: 1, yield_uom: 'each', lines: [] },
    });
    await expect(svc.platedCostForVersion(OTHER_RID, version.version.id))
      .rejects.toThrow(RecipeNotFoundError);
  });

  it('throws RecipeNotFoundError for an unknown version id', async () => {
    const mem = inMemory();
    const svc = new RecipesService({ recipes: mem.recipeRepo, versions: mem.versionRepo, costs: costCtx() });
    await expect(svc.platedCostForVersion(RID, 'does-not-exist'))
      .rejects.toThrow(RecipeNotFoundError);
  });
});

describe('RecipesService archive', () => {
  it('archives an existing recipe', async () => {
    const mem = inMemory();
    const svc = new RecipesService({ recipes: mem.recipeRepo, versions: mem.versionRepo, costs: costCtx() });
    const { recipe } = await svc.create(RID, { type: 'prep', name: 'X', initial_version: { yield_qty: 1, yield_uom: 'each', lines: [] } });
    await svc.archive(RID, recipe.id);
    const all = await svc.list(RID, { includeArchived: false });
    expect(all).toHaveLength(0);
  });

  it('throws for a missing recipe', async () => {
    const mem = inMemory();
    const svc = new RecipesService({ recipes: mem.recipeRepo, versions: mem.versionRepo, costs: costCtx() });
    await expect(svc.archive(RID, 'does-not-exist')).rejects.toThrow(RecipeNotFoundError);
  });
});
