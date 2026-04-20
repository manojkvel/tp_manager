// TASK-040 — Station-view composition (§6.3b).
//
// Pure: given recipes + their current version + lines, produce a flat list of
// rows for a specific station, ordered by recipe name then step_order.

import type { RecipeLineRow } from './cost.js';

export interface StationRecipe {
  recipe_id: string;
  recipe_name: string;
  station: string;
  version_id: string;
  yield_qty: number;
  yield_uom: string;
  lines: RecipeLineRow[];
}

export interface StationViewRow {
  recipe_id: string;
  recipe_name: string;
  step_order: number | null;
  line: RecipeLineRow;
}

/** Filter and order recipes+lines for a given station. */
export function stationView(recipes: StationRecipe[], station: string): StationViewRow[] {
  const rows: StationViewRow[] = [];
  for (const r of recipes) {
    const lines = r.lines
      .filter((l) => l.station === station)
      .sort((a, b) => (a.step_order ?? a.position) - (b.step_order ?? b.position));
    for (const l of lines) {
      rows.push({ recipe_id: r.recipe_id, recipe_name: r.recipe_name, step_order: l.step_order, line: l });
    }
  }
  return rows.sort((a, b) => a.recipe_name.localeCompare(b.recipe_name));
}
