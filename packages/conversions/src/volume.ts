import { ConversionError } from './errors.js';

// All volume units normalised to millilitres. US customary (not imperial).
const VOLUME_TO_ML: Record<string, number> = {
  mL: 1,
  L: 1000,
  tsp: 4.92892159375, // US tsp
  tbsp: 14.78676478125, // US tbsp (3 tsp)
  fl_oz: 29.5735295625, // US fl oz
  cup: 236.5882365, // US cup (8 fl oz)
  pint: 473.176473, // US liquid pint
  quart: 946.352946,
  gallon: 3785.411784,
};

export type VolumeUnit = keyof typeof VOLUME_TO_ML;

export function isVolumeUnit(u: string): u is VolumeUnit {
  return Object.prototype.hasOwnProperty.call(VOLUME_TO_ML, u);
}

export function volumeToMl(qty: number, unit: VolumeUnit): number {
  const factor = VOLUME_TO_ML[unit];
  if (factor === undefined) {
    throw new ConversionError(`unknown volume unit: ${String(unit)}`, 'unknown_unit');
  }
  return qty * factor;
}

export function mlToVolume(qtyMl: number, unit: VolumeUnit): number {
  const factor = VOLUME_TO_ML[unit];
  if (factor === undefined) {
    throw new ConversionError(`unknown volume unit: ${String(unit)}`, 'unknown_unit');
  }
  return qtyMl / factor;
}

export function convertVolume(qty: number, from: VolumeUnit, to: VolumeUnit): number {
  if (!isVolumeUnit(from) || !isVolumeUnit(to)) {
    throw new ConversionError(
      `convertVolume: unsupported unit pair ${String(from)}→${String(to)}. Use convertVolumeToWeight for cross-category.`,
      'not_convertible',
    );
  }
  if (from === to) return qty;
  return mlToVolume(volumeToMl(qty, from), to);
}
