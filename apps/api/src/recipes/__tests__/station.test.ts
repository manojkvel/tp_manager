// TASK-039 — station view unit tests (§6.3b).

import { describe, it, expect } from 'vitest';
import { stationView, type StationRecipe } from '../station.js';
import type { RecipeLineRow } from '../cost.js';

function line(overrides: Partial<RecipeLineRow>): RecipeLineRow {
  return {
    id: `l-${Math.random().toString(36).slice(2, 7)}`,
    recipe_version_id: 'v1',
    position: 0,
    ref_type: 'ingredient',
    ingredient_id: null,
    ref_recipe_id: null,
    qty: 0, qty_text: null, uom: null, note: null,
    station: null, step_order: null, utensil_id: null,
    ...overrides,
  };
}

describe('stationView (§6.3b)', () => {
  const recipes: StationRecipe[] = [
    {
      recipe_id: 'omelette', recipe_name: 'Omelette',
      station: 'egg', version_id: 'v1', yield_qty: 1, yield_uom: 'each',
      lines: [
        line({ station: 'egg',       step_order: 2, note: 'fold' }),
        line({ station: 'egg',       step_order: 1, note: 'pour' }),
        line({ station: 'expo',      step_order: 3, note: 'plate' }),
        line({ station: null,        step_order: null, note: 'side note' }),
      ],
    },
    {
      recipe_id: 'benedict', recipe_name: 'Eggs Benedict',
      station: 'egg', version_id: 'v2', yield_qty: 1, yield_uom: 'each',
      lines: [
        line({ station: 'egg',       step_order: 1, note: 'poach' }),
      ],
    },
  ];

  it('filters to lines matching the requested station', () => {
    const rows = stationView(recipes, 'egg');
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.line.station === 'egg')).toBe(true);
  });

  it('orders within a recipe by step_order', () => {
    const rows = stationView(recipes, 'egg').filter((r) => r.recipe_id === 'omelette');
    expect(rows.map((r) => r.step_order)).toEqual([1, 2]);
  });

  it('orders recipes alphabetically by name', () => {
    const rows = stationView(recipes, 'egg');
    expect(rows.map((r) => r.recipe_name)).toEqual(['Eggs Benedict', 'Omelette', 'Omelette']);
  });

  it('excludes lines with null station', () => {
    const rows = stationView(recipes, 'egg');
    expect(rows.some((r) => r.line.station === null)).toBe(false);
  });
});
