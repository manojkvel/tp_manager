// @tp/conversions — pure conversion module (TASK-017 / AD-4).
// No side effects. No I/O. No schema dependencies beyond `packages/types`.
// Property-based tests live in `__tests__/`.

export { ConversionError, type ConversionErrorReason } from './errors.js';
export {
  convertWeight,
  isWeightUnit,
  type WeightUnit,
} from './weight.js';
export {
  convertVolume,
  isVolumeUnit,
  mlToVolume,
  volumeToMl,
  type VolumeUnit,
} from './volume.js';
export { convertVolumeToWeight, convertWeightToVolume } from './volume_weight.js';
export {
  resolveUtensilLine,
  type UtensilEquivalence,
  type ResolveUtensilLineInput,
  type ResolvedUtensilLine,
} from './utensil.js';
export { resolveDensity, seedDensity, type IngredientKey } from './densities.js';
