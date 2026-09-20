import { basisPoints } from './money.mjs';

export const FUEL_BP = 850;
export const HEAVY_THRESHOLD_GRAMS = 30000;
export const HEAVY_CENTS = 1500;
export const REMOTE_CENTS = 700;

/** SPEC 5. `baseCents` is the undiscounted base fee. */
export function surcharges({ baseCents, grams, zone }) {
  const list = [{ kind: 'fuel', cents: basisPoints(baseCents, FUEL_BP) }];
  if (grams >= HEAVY_THRESHOLD_GRAMS) list.push({ kind: 'heavy', cents: HEAVY_CENTS });
  if (zone.remote) list.push({ kind: 'remote', cents: REMOTE_CENTS });
  return list;
}
