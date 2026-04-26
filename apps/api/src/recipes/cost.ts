// TASK-040 — plated-cost calculator + cycle detector.
//
// Pure: no Prisma, no I/O. The caller supplies resolver functions so the same
// code powers live reads and historical (version-pinned) reads.
//
// §6.3 AC-4/5/8, §6.3a AC-1..4, AD-4.

import {
  convertWeight, isWeightUnit, type WeightUnit,
  convertVolume, isVolumeUnit, type VolumeUnit,
  convertVolumeToWeight, convertWeightToVolume,
  resolveUtensilLine, type UtensilEquivalence,
  ConversionError,
} from '@tp/conversions';

export type RecipeLineRefType = 'ingredient' | 'recipe';

export interface RecipeLineRow {
  id: string;
  recipe_version_id: string;
  position: number;
  ref_type: RecipeLineRefType;
  ingredient_id: string | null;
  ref_recipe_id: string | null;
  qty: number;
  qty_text: string | null;
  uom: string | null;
  note: string | null;
  station: string | null;
  step_order: number | null;
  utensil_id: string | null;
  /** Resolved display name of the referenced ingredient or sub-recipe. Joined
   *  by the repo; cost math ignores it. Optional so non-repo callers (tests,
   *  pure fixtures) don't need to supply it. */
  ref_name?: string | null;
}

export interface RecipeVersionRow {
  id: string;
  recipe_id: string;
  version: number;
  is_current: boolean;
  yield_qty: number;
  yield_uom: string;
}

export interface IngredientRef {
  id: string;
  uom: string;
  density_g_per_ml: number | null;
}

export interface CostContext {
  /** Resolve the current (or a specific) RecipeVersion for a recipe_id. */
  resolveVersion(recipe_id: string): Promise<{ version: RecipeVersionRow; lines: RecipeLineRow[] } | null>;
  /** Ingredient unit cost in cents per `ingredient.uom`. */
  ingredientCost(ingredient_id: string): Promise<number | null>;
  ingredient(ingredient_id: string): Promise<IngredientRef | null>;
  utensilEquivalences(utensil_id: string): Promise<readonly UtensilEquivalence[]>;
}

export interface LineCostDetail {
  line_id: string;
  position: number;
  cents: number;
  skipped: 'text_qty' | 'missing_cost' | 'missing_utensil' | null;
  note?: string;
}

export interface PlatedCostResult {
  total_cents: number;
  per_yield_unit_cents: number;
  lines: LineCostDetail[];
}

export class RecipeCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`recipe graph contains a cycle: ${cycle.join(' → ')}`);
    this.name = 'RecipeCycleError';
  }
}

export class MissingCostError extends Error {
  constructor(ingredient_id: string) {
    super(`ingredient ${ingredient_id} has no cost history`);
    this.name = 'MissingCostError';
  }
}

/**
 * Compute plated cost for a given recipe version.
 *
 * @throws RecipeCycleError if the nested-BOM walk revisits an ancestor.
 * @throws ConversionError  if a utensil line has no equivalence or a cross-unit
 *                          conversion needs a density and none is set.
 */
export async function computePlatedCost(
  version: RecipeVersionRow,
  lines: RecipeLineRow[],
  ctx: CostContext,
  stack: string[] = [],
): Promise<PlatedCostResult> {
  if (stack.includes(version.recipe_id)) {
    throw new RecipeCycleError([...stack, version.recipe_id]);
  }
  const nextStack = [...stack, version.recipe_id];

  const details: LineCostDetail[] = [];
  let total = 0;

  for (const line of lines) {
    if (line.qty_text && (line.qty == null || Number.isNaN(line.qty))) {
      details.push({ line_id: line.id, position: line.position, cents: 0, skipped: 'text_qty' });
      continue;
    }
    if (line.ref_type === 'recipe') {
      if (!line.ref_recipe_id) {
        details.push({ line_id: line.id, position: line.position, cents: 0, skipped: 'missing_cost', note: 'recipe-line without ref_recipe_id' });
        continue;
      }
      const child = await ctx.resolveVersion(line.ref_recipe_id);
      if (!child) {
        details.push({ line_id: line.id, position: line.position, cents: 0, skipped: 'missing_cost', note: 'referenced recipe not found' });
        continue;
      }
      const childResult = await computePlatedCost(child.version, child.lines, ctx, nextStack);
      // Convert qty (in line.uom) into child's yield_uom if they differ — else straight ratio.
      const qtyInYield = line.uom && line.uom !== child.version.yield_uom
        ? convertSameCategory(line.qty, line.uom, child.version.yield_uom, null)
        : line.qty;
      const cents = Math.round((childResult.total_cents / child.version.yield_qty) * qtyInYield);
      total += cents;
      details.push({ line_id: line.id, position: line.position, cents, skipped: null });
      continue;
    }

    // ref_type === 'ingredient'
    if (!line.ingredient_id) {
      details.push({ line_id: line.id, position: line.position, cents: 0, skipped: 'missing_cost' });
      continue;
    }
    const ing = await ctx.ingredient(line.ingredient_id);
    if (!ing) {
      details.push({ line_id: line.id, position: line.position, cents: 0, skipped: 'missing_cost', note: 'ingredient not found' });
      continue;
    }
    const unitCost = await ctx.ingredientCost(line.ingredient_id);
    if (unitCost == null) {
      details.push({ line_id: line.id, position: line.position, cents: 0, skipped: 'missing_cost' });
      continue;
    }

    // Utensil line: qty is in utensil units; resolve to physical qty+uom first.
    // A missing default+override pair is a recoverable per-line warning (§6.3a
    // AC-3 "needs fixup banner"), not a fatal — other lines still cost.
    let physQty = line.qty;
    let physUom = line.uom ?? ing.uom;
    if (line.utensil_id) {
      const eqs = await ctx.utensilEquivalences(line.utensil_id);
      try {
        const resolved = resolveUtensilLine({
          utensilId: line.utensil_id,
          ingredientId: line.ingredient_id,
          qty: line.qty,
          equivalences: eqs as UtensilEquivalence[],
        });
        physQty = resolved.qty;
        physUom = resolved.uom;
      } catch (err) {
        if (err instanceof ConversionError) {
          details.push({ line_id: line.id, position: line.position, cents: 0, skipped: 'missing_utensil', note: err.message });
          continue;
        }
        throw err;
      }
    }

    // Convert to ingredient's stock uom.
    const qtyInIngredientUom = physUom === ing.uom
      ? physQty
      : convertSameCategory(physQty, physUom, ing.uom, ing.density_g_per_ml);
    const cents = Math.round(unitCost * qtyInIngredientUom);
    total += cents;
    details.push({ line_id: line.id, position: line.position, cents, skipped: null });
  }

  return {
    total_cents: total,
    per_yield_unit_cents: version.yield_qty > 0 ? total / version.yield_qty : 0,
    lines: details,
  };
}

function convertSameCategory(qty: number, from: string, to: string, density: number | null): number {
  if (from === to) return qty;
  if (isWeightUnit(from) && isWeightUnit(to)) {
    return convertWeight(qty, from as WeightUnit, to as WeightUnit);
  }
  if (isVolumeUnit(from) && isVolumeUnit(to)) {
    return convertVolume(qty, from as VolumeUnit, to as VolumeUnit);
  }
  if (isVolumeUnit(from) && isWeightUnit(to)) {
    if (density == null) throw new ConversionError(`density required to convert ${from}→${to}`, 'missing_density');
    return convertVolumeToWeight(qty, from as VolumeUnit, to as WeightUnit, density);
  }
  if (isWeightUnit(from) && isVolumeUnit(to)) {
    if (density == null) throw new ConversionError(`density required to convert ${from}→${to}`, 'missing_density');
    return convertWeightToVolume(qty, from as WeightUnit, to as VolumeUnit, density);
  }
  throw new ConversionError(`unsupported unit pair ${from}→${to}`, 'not_convertible');
}

/** Detect a cycle without computing cost. Returns the cycle path or null. */
export async function detectCycle(
  startRecipeId: string,
  resolve: (recipe_id: string) => Promise<{ lines: Pick<RecipeLineRow, 'ref_type' | 'ref_recipe_id'>[] } | null>,
): Promise<string[] | null> {
  const visited = new Set<string>();
  async function walk(id: string, stack: string[]): Promise<string[] | null> {
    if (stack.includes(id)) return [...stack, id];
    if (visited.has(id)) return null;
    visited.add(id);
    const v = await resolve(id);
    if (!v) return null;
    for (const l of v.lines) {
      if (l.ref_type === 'recipe' && l.ref_recipe_id) {
        const hit = await walk(l.ref_recipe_id, [...stack, id]);
        if (hit) return hit;
      }
    }
    return null;
  }
  return walk(startRecipeId, []);
}
