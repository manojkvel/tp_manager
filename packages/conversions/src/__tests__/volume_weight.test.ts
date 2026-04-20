import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { convertVolume } from '../volume.js';
import { convertVolumeToWeight, convertWeightToVolume } from '../volume_weight.js';
import { ConversionError } from '../errors.js';

describe('conversions/volume — volume↔volume roundtrip (TASK-015 / §6.1 AC-6)', () => {
  it('mL → L → mL is lossless', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 10_000, noNaN: true }), (mL) => {
        const L = convertVolume(mL, 'mL', 'L');
        expect(convertVolume(L, 'L', 'mL')).toBeCloseTo(mL, 9);
      }),
      { numRuns: 200 },
    );
  });

  it('fl_oz → cup → fl_oz is lossless', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 10_000, noNaN: true }), (flOz) => {
        const cup = convertVolume(flOz, 'fl_oz', 'cup');
        expect(convertVolume(cup, 'cup', 'fl_oz')).toBeCloseTo(flOz, 6);
      }),
      { numRuns: 200 },
    );
  });

  it('1 cup = 236.5882365 mL (US)', () => {
    expect(convertVolume(1, 'cup', 'mL')).toBeCloseTo(236.5882365, 5);
  });
});

describe('conversions/volume_weight — requires density (TASK-015 / §6.1 AC-6, AD-4)', () => {
  it('1 mL water (density=1.00 g/mL) = 1 g', () => {
    expect(convertVolumeToWeight(1, 'mL', 'g', 1.0)).toBeCloseTo(1, 9);
  });

  it('1 cup water (236.5882 mL, density=1.00) → ~236.59 g', () => {
    expect(convertVolumeToWeight(1, 'cup', 'g', 1.0)).toBeCloseTo(236.5882365, 5);
  });

  it('weight → volume is the roundtrip inverse when density is provided', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 0.3, max: 1.6, noNaN: true }),
        (g, density) => {
          const mL = convertWeightToVolume(g, 'g', 'mL', density);
          const back = convertVolumeToWeight(mL, 'mL', 'g', density);
          expect(back).toBeCloseTo(g, 6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('missing density errors LOUDLY — not silently', () => {
    // Undefined density must throw — silent "assume water" is the whole AD-4 failure mode we reject.
    expect(() => convertVolumeToWeight(1, 'mL', 'g', undefined as unknown as number)).toThrow(
      ConversionError,
    );
    expect(() => convertVolumeToWeight(1, 'mL', 'g', null as unknown as number)).toThrow(
      ConversionError,
    );
    expect(() => convertVolumeToWeight(1, 'mL', 'g', Number.NaN)).toThrow(ConversionError);
  });

  it('zero or negative density is rejected', () => {
    expect(() => convertVolumeToWeight(1, 'mL', 'g', 0)).toThrow(ConversionError);
    expect(() => convertVolumeToWeight(1, 'mL', 'g', -0.5)).toThrow(ConversionError);
  });

  it('ConversionError carries reason="missing_density" when density is falsy', () => {
    try {
      convertVolumeToWeight(1, 'mL', 'g', undefined as unknown as number);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConversionError);
      expect((e as ConversionError).reason).toBe('missing_density');
    }
  });
});
