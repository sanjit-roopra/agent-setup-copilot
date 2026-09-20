import { basisPoints } from './money.mjs';

export const MINIMUM_CENTS = 250;

export function volumeDiscountBp(monthlyShipments) {
  if (monthlyShipments >= 500) return 1200;
  if (monthlyShipments >= 100) return 500;
  return 0;
}

/** SPEC 6: volume discount on the full base fee first, coupon afterwards, then the floor. */
export function discountedBase({ baseCents, monthlyShipments = 0, couponCents = 0 }) {
  if (couponCents < 0) throw new RangeError('coupon must not be negative');
  const afterVolume = baseCents - basisPoints(baseCents, volumeDiscountBp(monthlyShipments));
  const afterCoupon = afterVolume - couponCents;
  return Math.max(MINIMUM_CENTS, afterCoupon);
}
