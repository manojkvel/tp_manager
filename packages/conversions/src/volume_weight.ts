import { ConversionError } from './errors.js';
import { convertWeight, isWeightUnit, type WeightUnit } from './weight.js';
import { isVolumeUnit, mlToVolume, volumeToMl, type VolumeUnit } from './volume.js';

/**
 * Convert a volume quantity to a weight quantity, given the ingredient's
 * density in g/mL.
 *
 * AD-4 explicitly forbids silent fallbacks: if `density_g_per_ml` is missing
 * (undefined / null / NaN / ≤ 0) we throw `missing_density` rather than
 * assuming water. The spec §6.1 AC-6 promise to users is that weight↔volume
 * always carries explainable arithmetic — a silent "assume water" would
 * produce wrong costs for everything except water.
 */
export function convertVolumeToWeight(
  qty: number,
  fromVolume: VolumeUnit,
  toWeight: WeightUnit,
  densityGPerMl: number,
): number {
  assertDensity(densityGPerMl);
  if (!isVolumeUnit(fromVolume)) {
    throw new ConversionError(`unknown volume unit: ${String(fromVolume)}`, 'unknown_unit');
  }
  if (!isWeightUnit(toWeight)) {
    throw new ConversionError(`unknown weight unit: ${String(toWeight)}`, 'unknown_unit');
  }
  const mL = volumeToMl(qty, fromVolume);
  const grams = mL * densityGPerMl;
  return convertWeight(grams, 'g', toWeight);
}

/**
 * Inverse of `convertVolumeToWeight`. Equally density-required.
 */
export function convertWeightToVolume(
  qty: number,
  fromWeight: WeightUnit,
  toVolume: VolumeUnit,
  densityGPerMl: number,
): number {
  assertDensity(densityGPerMl);
  if (!isWeightUnit(fromWeight)) {
    throw new ConversionError(`unknown weight unit: ${String(fromWeight)}`, 'unknown_unit');
  }
  if (!isVolumeUnit(toVolume)) {
    throw new ConversionError(`unknown volume unit: ${String(toVolume)}`, 'unknown_unit');
  }
  const grams = convertWeight(qty, fromWeight, 'g');
  const mL = grams / densityGPerMl;
  return mlToVolume(mL, toVolume);
}

function assertDensity(density: number): void {
  if (density === undefined || density === null || typeof density !== 'number') {
    throw new ConversionError(
      'density_g_per_ml is required for volume↔weight conversion',
      'missing_density',
    );
  }
  if (Number.isNaN(density)) {
    throw new ConversionError(
      'density_g_per_ml is NaN — ingredient is missing a density value',
      'missing_density',
    );
  }
  if (density <= 0) {
    throw new ConversionError(
      `density_g_per_ml must be > 0, got ${density}`,
      'missing_density',
    );
  }
}
