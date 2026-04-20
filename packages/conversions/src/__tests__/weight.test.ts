import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { convertWeight } from '../weight.js';
import { ConversionError } from '../errors.js';

describe('conversions/weight — weight↔weight roundtrip (TASK-015 / §6.1 AC-6, AD-4)', () => {
  it('g → oz → g is lossless within float tolerance', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 1_000_000, noNaN: true }), (g) => {
        const oz = convertWeight(g, 'g', 'oz');
        const back = convertWeight(oz, 'oz', 'g');
        expect(back).toBeCloseTo(g, 6);
      }),
      { numRuns: 200 },
    );
  });

  it('oz → lb → oz is lossless', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 10_000, noNaN: true }), (oz) => {
        const lb = convertWeight(oz, 'oz', 'lb');
        const back = convertWeight(lb, 'lb', 'oz');
        expect(back).toBeCloseTo(oz, 6);
      }),
      { numRuns: 200 },
    );
  });

  it('kg → g → kg is exact (integer factor)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 10_000, noNaN: true }), (kg) => {
        const g = convertWeight(kg, 'kg', 'g');
        expect(g).toBeCloseTo(kg * 1000, 9);
        const back = convertWeight(g, 'g', 'kg');
        expect(back).toBeCloseTo(kg, 9);
      }),
      { numRuns: 200 },
    );
  });

  it('known fixed points match published factors', () => {
    expect(convertWeight(1, 'lb', 'g')).toBeCloseTo(453.59237, 5);
    expect(convertWeight(1, 'oz', 'g')).toBeCloseTo(28.3495231, 5);
    expect(convertWeight(1000, 'g', 'kg')).toBeCloseTo(1, 9);
  });

  it('same-unit conversion is identity', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (x) => {
        expect(convertWeight(x, 'g', 'g')).toBe(x);
        expect(convertWeight(x, 'oz', 'oz')).toBe(x);
      }),
    );
  });

  it('cross-category conversion (weight→volume without density) throws ConversionError', () => {
    // The weight API refuses volume units — callers must route through convertVolumeToWeight.
    expect(() => convertWeight(1, 'g', 'mL' as unknown as 'g')).toThrow(ConversionError);
  });
});
