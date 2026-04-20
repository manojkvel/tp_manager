import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveUtensilLine } from '../utensil.js';
import type { UtensilEquivalence } from '../utensil.js';
import { ConversionError } from '../errors.js';

const blueScoopDefault: UtensilEquivalence = {
  utensilId: 'blue-scoop',
  ingredientId: null,
  equivalentQty: 2,
  equivalentUom: 'oz',
  source: 'default',
};

const blueScoopGranolaOverride: UtensilEquivalence = {
  utensilId: 'blue-scoop',
  ingredientId: 'granola',
  equivalentQty: 0.9,
  equivalentUom: 'oz',
  source: 'override',
};

const blueScoopTomatoOverride: UtensilEquivalence = {
  utensilId: 'blue-scoop',
  ingredientId: 'diced-tomato',
  equivalentQty: 2.3,
  equivalentUom: 'oz',
  source: 'override',
};

describe('conversions/utensil — resolve utensil line (TASK-016 / §6.3a AC-3/4)', () => {
  it('picks the per-ingredient override when present', () => {
    const equivalences = [blueScoopDefault, blueScoopGranolaOverride];
    const result = resolveUtensilLine({
      utensilId: 'blue-scoop',
      ingredientId: 'granola',
      qty: 2,
      equivalences,
    });
    // 2 × 0.9 oz = 1.8 oz
    expect(result).toEqual({ qty: 1.8, uom: 'oz', source: 'override' });
  });

  it('falls back to utensil default when no override exists for the ingredient', () => {
    const equivalences = [blueScoopDefault, blueScoopGranolaOverride];
    const result = resolveUtensilLine({
      utensilId: 'blue-scoop',
      ingredientId: 'avocado-chunk',
      qty: 2,
      equivalences,
    });
    // 2 × 2 oz = 4 oz
    expect(result).toEqual({ qty: 4, uom: 'oz', source: 'default' });
  });

  it('picks the right override when multiple ingredients have overrides', () => {
    const equivalences = [blueScoopDefault, blueScoopGranolaOverride, blueScoopTomatoOverride];
    const granola = resolveUtensilLine({
      utensilId: 'blue-scoop',
      ingredientId: 'granola',
      qty: 1,
      equivalences,
    });
    const tomato = resolveUtensilLine({
      utensilId: 'blue-scoop',
      ingredientId: 'diced-tomato',
      qty: 1,
      equivalences,
    });
    expect(granola.qty).toBeCloseTo(0.9, 9);
    expect(granola.source).toBe('override');
    expect(tomato.qty).toBeCloseTo(2.3, 9);
    expect(tomato.source).toBe('override');
  });

  it('fractional qty (e.g., ½ Blue Scoop Pickled Onions) is supported (§6.3a edge case)', () => {
    const result = resolveUtensilLine({
      utensilId: 'blue-scoop',
      ingredientId: 'pickled-onions',
      qty: 0.5,
      equivalences: [blueScoopDefault],
    });
    expect(result.qty).toBeCloseTo(1, 9);
  });

  it('property: source is "override" iff a matching override exists', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('granola', 'avocado-chunk', 'diced-tomato', 'pickled-onions'),
        fc.double({ min: 0.25, max: 10, noNaN: true }),
        (ingredientId, qty) => {
          const equivalences = [blueScoopDefault, blueScoopGranolaOverride, blueScoopTomatoOverride];
          const result = resolveUtensilLine({
            utensilId: 'blue-scoop',
            ingredientId,
            qty,
            equivalences,
          });
          const hasOverride = equivalences.some(
            (e) => e.utensilId === 'blue-scoop' && e.ingredientId === ingredientId,
          );
          expect(result.source).toBe(hasOverride ? 'override' : 'default');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('throws when utensil has neither default nor ingredient override', () => {
    expect(() =>
      resolveUtensilLine({
        utensilId: 'mystery-scoop',
        ingredientId: 'granola',
        qty: 1,
        equivalences: [],
      }),
    ).toThrow(ConversionError);
  });

  it('ConversionError carries reason="not_convertible" on chain miss', () => {
    try {
      resolveUtensilLine({
        utensilId: 'mystery-scoop',
        ingredientId: 'granola',
        qty: 1,
        equivalences: [],
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConversionError);
      expect((e as ConversionError).reason).toBe('not_convertible');
    }
  });
});
