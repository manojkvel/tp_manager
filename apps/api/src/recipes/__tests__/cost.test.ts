// TASK-038/039 — plated-cost + cycle-detection unit tests (pure, DB-free).

import { describe, it, expect } from 'vitest';
import {
  computePlatedCost,
  detectCycle,
  RecipeCycleError,
  type CostContext,
  type RecipeLineRow,
  type RecipeVersionRow,
  type IngredientRef,
} from '../cost.js';
import type { UtensilEquivalence } from '@tp/conversions';

function line(overrides: Partial<RecipeLineRow>): RecipeLineRow {
  return {
    id: overrides.id ?? `line-${Math.random().toString(36).slice(2, 7)}`,
    recipe_version_id: overrides.recipe_version_id ?? 'v1',
    position: overrides.position ?? 0,
    ref_type: overrides.ref_type ?? 'ingredient',
    ingredient_id: overrides.ingredient_id ?? null,
    ref_recipe_id: overrides.ref_recipe_id ?? null,
    qty: overrides.qty ?? 0,
    qty_text: overrides.qty_text ?? null,
    uom: overrides.uom ?? null,
    note: overrides.note ?? null,
    station: overrides.station ?? null,
    step_order: overrides.step_order ?? null,
    utensil_id: overrides.utensil_id ?? null,
  };
}

function version(recipe_id: string, v: Partial<RecipeVersionRow> = {}): RecipeVersionRow {
  return {
    id: v.id ?? `${recipe_id}-v${v.version ?? 1}`,
    recipe_id,
    version: v.version ?? 1,
    is_current: v.is_current ?? true,
    yield_qty: v.yield_qty ?? 1,
    yield_uom: v.yield_uom ?? 'each',
  };
}

function ctxBuilder(opts: {
  versions?: Map<string, { version: RecipeVersionRow; lines: RecipeLineRow[] }>;
  ingredients?: Map<string, IngredientRef>;
  costs?: Map<string, number>;
  equivs?: Map<string, UtensilEquivalence[]>;
}): CostContext {
  const versions = opts.versions ?? new Map();
  const ingredients = opts.ingredients ?? new Map();
  const costs = opts.costs ?? new Map();
  const equivs = opts.equivs ?? new Map();
  return {
    async resolveVersion(id) { return versions.get(id) ?? null; },
    async ingredient(id) { return ingredients.get(id) ?? null; },
    async ingredientCost(id) { return costs.get(id) ?? null; },
    async utensilEquivalences(id) { return equivs.get(id) ?? []; },
  };
}

describe('computePlatedCost — flat recipe (§6.3 AC-4)', () => {
  it('sums ingredient-line costs when units match', async () => {
    const ctx = ctxBuilder({
      ingredients: new Map([
        ['ing-1', { id: 'ing-1', uom: 'g', density_g_per_ml: null }],
        ['ing-2', { id: 'ing-2', uom: 'each', density_g_per_ml: null }],
      ]),
      costs: new Map([['ing-1', 2], ['ing-2', 50]]), // 2¢/g, 50¢/each
    });
    const v = version('R1');
    const lines = [
      line({ position: 0, ingredient_id: 'ing-1', qty: 100, uom: 'g' }),
      line({ position: 1, ingredient_id: 'ing-2', qty: 3, uom: 'each' }),
    ];
    const result = await computePlatedCost(v, lines, ctx);
    expect(result.total_cents).toBe(100 * 2 + 3 * 50); // 350
    expect(result.lines).toHaveLength(2);
    expect(result.lines.every((l) => l.skipped === null)).toBe(true);
  });

  it('converts line uom to ingredient uom (g ↔ kg)', async () => {
    const ctx = ctxBuilder({
      ingredients: new Map([['ing-1', { id: 'ing-1', uom: 'kg', density_g_per_ml: null }]]),
      costs: new Map([['ing-1', 500]]), // 500¢/kg
    });
    const v = version('R1');
    const lines = [line({ ingredient_id: 'ing-1', qty: 250, uom: 'g' })];
    const result = await computePlatedCost(v, lines, ctx);
    expect(result.total_cents).toBe(Math.round(500 * 0.25)); // 125
  });

  it('uses density for volume→weight conversion (AD-4)', async () => {
    const ctx = ctxBuilder({
      ingredients: new Map([['oil', { id: 'oil', uom: 'g', density_g_per_ml: 0.92 }]]),
      costs: new Map([['oil', 3]]), // 3¢/g
    });
    const v = version('R1');
    const lines = [line({ ingredient_id: 'oil', qty: 100, uom: 'mL' })];
    const result = await computePlatedCost(v, lines, ctx);
    // 100 mL × 0.92 g/mL = 92g × 3¢ = 276
    expect(result.total_cents).toBe(276);
  });

  it('skips qty_text lines without a numeric qty ("to taste")', async () => {
    const ctx = ctxBuilder({
      ingredients: new Map([['salt', { id: 'salt', uom: 'g', density_g_per_ml: null }]]),
      costs: new Map([['salt', 10]]),
    });
    const v = version('R1');
    const lines = [
      line({ ingredient_id: 'salt', qty: 10, uom: 'g' }),
      line({ ingredient_id: 'salt', qty: Number.NaN, qty_text: 'to taste' }),
    ];
    const result = await computePlatedCost(v, lines, ctx);
    expect(result.total_cents).toBe(10 * 10);
    expect(result.lines[1]!.skipped).toBe('text_qty');
  });

  it('marks missing cost as skipped without throwing', async () => {
    const ctx = ctxBuilder({
      ingredients: new Map([['mystery', { id: 'mystery', uom: 'g', density_g_per_ml: null }]]),
      costs: new Map(), // no cost recorded
    });
    const v = version('R1');
    const lines = [line({ ingredient_id: 'mystery', qty: 50, uom: 'g' })];
    const result = await computePlatedCost(v, lines, ctx);
    expect(result.total_cents).toBe(0);
    expect(result.lines[0]!.skipped).toBe('missing_cost');
  });
});

describe('computePlatedCost — nested BOM (§6.3 AC-4)', () => {
  it('rolls child recipe cost per-yield-unit into the parent line', async () => {
    const childV = version('sauce', { yield_qty: 1000, yield_uom: 'g' });
    const childLines = [
      line({ ingredient_id: 'tomato', qty: 900, uom: 'g' }), // 900g × 1¢ = 900
      line({ ingredient_id: 'salt', qty: 100, uom: 'g' }),   // 100g × 5¢ = 500
    ];
    const ctx = ctxBuilder({
      versions: new Map([['sauce', { version: childV, lines: childLines }]]),
      ingredients: new Map([
        ['tomato', { id: 'tomato', uom: 'g', density_g_per_ml: null }],
        ['salt',   { id: 'salt',   uom: 'g', density_g_per_ml: null }],
      ]),
      costs: new Map([['tomato', 1], ['salt', 5]]),
    });
    const parent = version('pasta');
    const parentLines = [
      line({ ref_type: 'recipe', ref_recipe_id: 'sauce', qty: 200, uom: 'g' }),
    ];
    const result = await computePlatedCost(parent, parentLines, ctx);
    // child total = 1400¢ for 1000g → 1.4¢/g × 200g = 280¢
    expect(result.total_cents).toBe(280);
  });
});

describe('computePlatedCost — cycle detection (§6.3 AC-8)', () => {
  it('throws RecipeCycleError when a recipe references itself', async () => {
    const vA = version('A');
    const lines = [line({ ref_type: 'recipe', ref_recipe_id: 'A', qty: 1, uom: 'each' })];
    const ctx = ctxBuilder({
      versions: new Map([['A', { version: vA, lines }]]),
    });
    await expect(computePlatedCost(vA, lines, ctx)).rejects.toThrow(RecipeCycleError);
  });

  it('throws on a 2-hop cycle A → B → A', async () => {
    const vA = version('A');
    const vB = version('B');
    const linesA = [line({ ref_type: 'recipe', ref_recipe_id: 'B', qty: 1, uom: 'each' })];
    const linesB = [line({ ref_type: 'recipe', ref_recipe_id: 'A', qty: 1, uom: 'each' })];
    const ctx = ctxBuilder({
      versions: new Map([
        ['A', { version: vA, lines: linesA }],
        ['B', { version: vB, lines: linesB }],
      ]),
    });
    await expect(computePlatedCost(vA, linesA, ctx)).rejects.toThrow(RecipeCycleError);
  });

  it('detectCycle returns the path (utility without computing cost)', async () => {
    const cycle = await detectCycle('A', async (id) => {
      if (id === 'A') return { lines: [{ ref_type: 'recipe', ref_recipe_id: 'B' }] };
      if (id === 'B') return { lines: [{ ref_type: 'recipe', ref_recipe_id: 'A' }] };
      return null;
    });
    expect(cycle).toEqual(['A', 'B', 'A']);
  });

  it('detectCycle returns null for a DAG', async () => {
    const cycle = await detectCycle('A', async (id) => {
      if (id === 'A') return { lines: [{ ref_type: 'recipe', ref_recipe_id: 'B' }] };
      if (id === 'B') return { lines: [{ ref_type: 'ingredient', ref_recipe_id: null }] };
      return null;
    });
    expect(cycle).toBeNull();
  });
});

describe('computePlatedCost — version-pinned historical cost (§6.3 AC-5, DEC-014)', () => {
  it('uses the cost resolver to reflect pinned cost for a specific version', async () => {
    // "Pin" is implemented by the caller supplying a resolver that returns the
    // cost as-of some date. Here we demonstrate that swapping the resolver
    // yields different plated cost for the same line set.
    const v = version('R1');
    const lines = [line({ ingredient_id: 'coffee', qty: 20, uom: 'g' })];
    const ingredients = new Map([['coffee', { id: 'coffee', uom: 'g', density_g_per_ml: null }]]);

    const now = await computePlatedCost(v, lines, ctxBuilder({
      ingredients, costs: new Map([['coffee', 5]]),
    }));
    const sixMonthsAgo = await computePlatedCost(v, lines, ctxBuilder({
      ingredients, costs: new Map([['coffee', 3]]),
    }));
    expect(now.total_cents).toBe(100);
    expect(sixMonthsAgo.total_cents).toBe(60);
  });
});

describe('computePlatedCost — utensil lines (§6.3a AC-1..4)', () => {
  const scoop = 'utensil-scoop';
  const base = ctxBuilder({
    ingredients: new Map([
      ['granola', { id: 'granola', uom: 'g', density_g_per_ml: null }],
      ['yogurt',  { id: 'yogurt',  uom: 'g', density_g_per_ml: null }],
    ]),
    costs: new Map([['granola', 2], ['yogurt', 4]]),
    equivs: new Map<string, UtensilEquivalence[]>([
      [scoop, [
        { utensilId: scoop, ingredientId: null,       equivalentQty: 60, equivalentUom: 'g', source: 'default'  },
        { utensilId: scoop, ingredientId: 'granola',  equivalentQty: 40, equivalentUom: 'g', source: 'override' },
      ]],
    ]),
  });

  it('uses the utensil default equivalence when no override exists', async () => {
    const v = version('R1');
    const lines = [line({ ingredient_id: 'yogurt', utensil_id: scoop, qty: 2, uom: 'each' })];
    const result = await computePlatedCost(v, lines, base);
    // 2 scoops × 60g × 4¢ = 480¢
    expect(result.total_cents).toBe(480);
  });

  it('per-ingredient override wins over default (§6.3a AC-4)', async () => {
    const v = version('R1');
    const lines = [line({ ingredient_id: 'granola', utensil_id: scoop, qty: 2, uom: 'each' })];
    const result = await computePlatedCost(v, lines, base);
    // 2 scoops × 40g × 2¢ = 160¢  (override)
    expect(result.total_cents).toBe(160);
  });

  it('throws ConversionError when utensil has no default and no override', async () => {
    const ctx = ctxBuilder({
      ingredients: new Map([['x', { id: 'x', uom: 'g', density_g_per_ml: null }]]),
      costs: new Map([['x', 1]]),
      equivs: new Map(), // none
    });
    const v = version('R1');
    const lines = [line({ ingredient_id: 'x', utensil_id: 'utensil-missing', qty: 1, uom: 'each' })];
    await expect(computePlatedCost(v, lines, ctx)).rejects.toThrow(/has no default/);
  });
});
