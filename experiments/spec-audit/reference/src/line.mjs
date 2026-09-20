import { billableGrams, STEP_GRAMS } from './weight.mjs';
import { zoneFor } from './zones.mjs';
import { surcharges } from './surcharge.mjs';
import { discountedBase } from './discount.mjs';

/** SPEC 4 and 7: one priced shipment line. */
export function priceLine({ parcel, postalCode, monthlyShipments = 0, couponCents = 0 }) {
  const grams = billableGrams(parcel);
  const zone = zoneFor(postalCode);
  const baseCents = zone.baseCents + zone.perStepCents * (grams / STEP_GRAMS);
  const extras = surcharges({ baseCents, grams, zone });
  const discounted = discountedBase({ baseCents, monthlyShipments, couponCents });
  const totalCents = discounted + extras.reduce((sum, extra) => sum + extra.cents, 0);
  return { zone, grams, baseCents, discountedBaseCents: discounted, surcharges: extras, totalCents };
}
