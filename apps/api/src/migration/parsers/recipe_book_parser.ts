// TASK-046 — recipe_book_parser (§6.14 AC-3, v1.6 scope: EN body only).
//
// Accepts a matrix of rows (pre-loaded from `TP Recipe Book.xlsx`). Expected
// canonical columns (case-insensitive, header row required):
//   recipe_name | type | yield_qty | yield_uom | line_position | ingredient_name
//   | qty | uom | station | step_order | ref_recipe_name | qty_text
//
// Each row that belongs to the same `recipe_name` groups into one staging
// recipe; the row becomes a staging line. Spanish columns — if present —
// are ignored per v1.6 scope trim.

import { randomUUID } from 'node:crypto';
import type {
  Parser, ParseResult, StagingRecipe, StagingRecipeLine,
} from '../types.js';

export interface RecipeBookParserOutput {
  recipes: StagingRecipe[];
  lines: StagingRecipeLine[];
}

export const recipe_book_parser: Parser<readonly (readonly string[])[], RecipeBookParserOutput> = (rows, _ctx) => {
  const errors: ParseResult<never>['errors'] = [];
  if (rows.length === 0) return { rows: [], errors: [] } as unknown as ParseResult<RecipeBookParserOutput>;

  const header = rows[0]!.map((h) => normaliseHeader(h));
  const col = (key: string): number => header.indexOf(key);

  const idxName = col('recipe_name');
  const idxType = col('type');
  const idxYieldQty = col('yield_qty');
  const idxYieldUom = col('yield_uom');
  const idxLinePos = col('line_position');
  const idxIngredient = col('ingredient_name');
  const idxQty = col('qty');
  const idxUom = col('uom');
  const idxStation = col('station');
  const idxStepOrder = col('step_order');
  const idxRefRecipe = col('ref_recipe_name');
  const idxQtyText = col('qty_text');

  if (idxName < 0 || idxType < 0) {
    errors.push({ source_row_ref: 'header', message: 'missing required columns: recipe_name, type' });
    return buildResult({ recipes: [], lines: [] }, errors);
  }

  const byName = new Map<string, StagingRecipe>();
  const lines: StagingRecipeLine[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const name = (row[idxName] ?? '').trim();
    if (!name) {
      errors.push({ source_row_ref: `row:${i + 1}`, message: 'empty recipe_name' });
      continue;
    }
    const type = ((row[idxType] ?? '').toLowerCase().trim() === 'menu' ? 'menu' : 'prep') as 'prep' | 'menu';
    let recipe = byName.get(`${type}|${name}`);
    if (!recipe) {
      recipe = {
        staging_id: randomUUID(),
        source_row_ref: `row:${i + 1}`,
        type,
        name,
        yield_qty: numberAt(row, idxYieldQty, 1),
        yield_uom: (row[idxYieldUom] ?? 'each').trim() || 'each',
      };
      byName.set(`${type}|${name}`, recipe);
    }
    const ingredientName = (row[idxIngredient] ?? '').trim() || null;
    const refRecipeName = (row[idxRefRecipe] ?? '').trim() || null;
    if (!ingredientName && !refRecipeName) {
      // Header-only row for a recipe (procedure/notes) — skip as a line.
      continue;
    }
    lines.push({
      staging_id: randomUUID(),
      recipe_staging_id: recipe.staging_id,
      position: numberAt(row, idxLinePos, lines.filter((l) => l.recipe_staging_id === recipe!.staging_id).length),
      ingredient_name: ingredientName,
      ref_recipe_name: refRecipeName,
      qty: numberAt(row, idxQty, 0),
      qty_text: (row[idxQtyText] ?? '').trim() || undefined,
      uom: (row[idxUom] ?? '').trim() || undefined,
      station: (row[idxStation] ?? '').trim() || undefined,
      utensil_name: undefined,
    });
    // `step_order` read when present
    if (idxStepOrder >= 0) {
      const lastLine = lines[lines.length - 1]!;
      const step = numberAt(row, idxStepOrder, NaN);
      if (!Number.isNaN(step)) {
        // We append it as a field on the record for the writer — the domain
        // type doesn't carry step_order so we keep it in `qty_text` only if set
        // as a true number. Writers map step_order from this value.
        (lastLine as StagingRecipeLine & { step_order?: number }).step_order = step;
      }
    }
  }

  return buildResult({ recipes: [...byName.values()], lines }, errors);
};

function buildResult(
  out: RecipeBookParserOutput,
  errors: ParseResult<unknown>['errors'],
): ParseResult<RecipeBookParserOutput> {
  return { rows: [out], errors };
}

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function numberAt(row: readonly string[], idx: number, fallback: number): number {
  if (idx < 0) return fallback;
  const raw = row[idx];
  if (raw == null || raw === '') return fallback;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}
