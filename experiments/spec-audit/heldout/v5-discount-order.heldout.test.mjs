import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discountedBase } from '../src/discount.mjs';

test('the volume discount is taken on the full base fee, then the coupon', () => {
  assert.equal(discountedBase({ baseCents: 2000, monthlyShipments: 100, couponCents: 300 }), 1600);
  assert.equal(discountedBase({ baseCents: 2000, monthlyShipments: 500, couponCents: 300 }), 1460);
  assert.equal(discountedBase({ baseCents: 1150, monthlyShipments: 120, couponCents: 50 }), 1042);
});

test('each discount alone is unchanged', () => {
  assert.equal(discountedBase({ baseCents: 2000, monthlyShipments: 100 }), 1900);
  assert.equal(discountedBase({ baseCents: 2000, couponCents: 300 }), 1700);
  assert.equal(discountedBase({ baseCents: 2000, monthlyShipments: 99, couponCents: 0 }), 2000);
});
