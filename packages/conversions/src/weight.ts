import { ConversionError } from './errors.js';

// All weight units normalised to grams.
const WEIGHT_TO_G: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.3495231,
  lb: 453.59237,
};

export type WeightUnit = keyof typeof WEIGHT_TO_G;

export function isWeightUnit(u: string): u is WeightUnit {
  return Object.prototype.hasOwnProperty.call(WEIGHT_TO_G, u);
}

export function convertWeight(qty: number, from: WeightUnit, to: WeightUnit): number {
  if (!isWeightUnit(from) || !isWeightUnit(to)) {
    throw new ConversionError(
      `convertWeight: unsupported unit pair ${String(from)}→${String(to)}. Use convertVolumeToWeight for cross-category.`,
      'not_convertible',
    );
  }
  if (from === to) return qty;
  const grams = qty * (WEIGHT_TO_G[from] as number);
  return grams / (WEIGHT_TO_G[to] as number);
}
