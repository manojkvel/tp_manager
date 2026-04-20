// Density lookup (g / mL). The authoritative source is `ingredient.density_g_per_ml`
// in the DB — this module keeps a small seed table for common ingredients so
// migration scripts + tests have a reasonable starting point. The production
// lookup threads through this table via `resolveDensity(ingredient)`.
//
// Callers must still guard for missing density; AD-4 + the missing_density
// error make silent fallbacks impossible.

import { ConversionError } from './errors.js';

export type IngredientKey = string; // ingredient.id OR a canonical name slug

const SEED_DENSITIES_G_PER_ML: Readonly<Record<IngredientKey, number>> = Object.freeze({
  water: 1.0,
  milk: 1.03,
  cream_heavy: 0.994,
  olive_oil: 0.915,
  canola_oil: 0.915,
  honey: 1.42,
  maple_syrup: 1.33,
  granola: 0.45, // bulk density — varies widely; migration tool updates per ingredient
  flour_ap: 0.593,
  sugar_granulated: 0.845,
  salt_table: 1.217,
  diced_tomato: 0.99,
  avocado_chunk: 0.93,
});

export function seedDensity(key: IngredientKey): number | undefined {
  return SEED_DENSITIES_G_PER_ML[key];
}

/**
 * Resolve density for an ingredient, preferring the DB-stored value.
 * Throws `missing_density` if neither source provides a usable density.
 */
export function resolveDensity(
  ingredient: { density_g_per_ml: number | null },
  fallbackKey?: IngredientKey,
): number {
  if (
    typeof ingredient.density_g_per_ml === 'number' &&
    Number.isFinite(ingredient.density_g_per_ml) &&
    ingredient.density_g_per_ml > 0
  ) {
    return ingredient.density_g_per_ml;
  }
  if (fallbackKey) {
    const seed = seedDensity(fallbackKey);
    if (seed !== undefined) return seed;
  }
  throw new ConversionError(
    `no density available for ingredient (fallbackKey=${fallbackKey ?? 'n/a'})`,
    'missing_density',
  );
}
