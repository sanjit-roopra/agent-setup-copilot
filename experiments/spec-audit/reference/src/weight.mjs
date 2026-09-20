export const STEP_GRAMS = 500;
export const MAX_BILLABLE_GRAMS = 70000;

/** SPEC 2.1: volume / 5000 in kilograms, which is volume / 5 in grams. */
export function volumetricGrams({ lengthCm, widthCm, heightCm }) {
  return (lengthCm * widthCm * heightCm) / 5;
}

/** SPEC 2: the larger of actual and volumetric weight, in whole 500 g steps. */
export function billableGrams(parcel) {
  const { lengthCm, widthCm, heightCm, grams } = parcel;
  if (![lengthCm, widthCm, heightCm, grams].every(value => value > 0)) {
    throw new RangeError('parcel dimensions and weight must be positive');
  }
  const heavier = Math.max(grams, volumetricGrams(parcel));
  const stepped = Math.ceil(heavier / STEP_GRAMS) * STEP_GRAMS;
  if (stepped > MAX_BILLABLE_GRAMS) throw new RangeError(`parcel exceeds ${MAX_BILLABLE_GRAMS} g billable weight`);
  return stepped;
}
