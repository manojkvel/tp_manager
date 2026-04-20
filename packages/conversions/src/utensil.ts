import { ConversionError } from './errors.js';

// Mirrors `utensil_equivalence` rows. Either carries `ingredientId = null`
// (the utensil's default physical equivalent) or `ingredientId = <id>`
// (per-ingredient override, §6.3a AC-4).
export interface UtensilEquivalence {
  utensilId: string;
  ingredientId: string | null;
  equivalentQty: number;
  equivalentUom: string;
  source: 'default' | 'override';
}

export interface ResolveUtensilLineInput {
  utensilId: string;
  ingredientId: string;
  qty: number; // count of utensil units on the recipe line (fractional allowed, §6.3a edge case)
  equivalences: readonly UtensilEquivalence[];
}

export interface ResolvedUtensilLine {
  qty: number;
  uom: string;
  source: 'default' | 'override';
}

/**
 * Resolve a recipe line expressed in utensil units (e.g., "2 Blue Scoops of
 * granola") into a physical qty in the utensil's canonical uom (oz, mL, g).
 *
 * Precedence per §6.3a AC-4: per-ingredient override wins; otherwise fall back
 * to the utensil default. If neither exists we throw — a recipe line that
 * cannot resolve must surface a migration/fixup signal, never a silent zero.
 */
export function resolveUtensilLine(input: ResolveUtensilLineInput): ResolvedUtensilLine {
  const { utensilId, ingredientId, qty, equivalences } = input;

  const override = equivalences.find(
    (e) => e.utensilId === utensilId && e.ingredientId === ingredientId,
  );
  if (override) {
    return {
      qty: qty * override.equivalentQty,
      uom: override.equivalentUom,
      source: 'override',
    };
  }

  const def = equivalences.find((e) => e.utensilId === utensilId && e.ingredientId === null);
  if (def) {
    return {
      qty: qty * def.equivalentQty,
      uom: def.equivalentUom,
      source: 'default',
    };
  }

  throw new ConversionError(
    `utensil ${utensilId} has no default and no override for ingredient ${ingredientId}`,
    'not_convertible',
  );
}
