import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceLine } from '../src/line.mjs';
import { buildInvoice } from '../src/invoice.mjs';
import { dispatchDate } from '../src/schedule.mjs';
import { billableGrams } from '../src/weight.mjs';
import { zoneFor } from '../src/zones.mjs';

const small = { lengthCm: 10, widthCm: 10, heightCm: 10, grams: 1300 };

test('billable weight uses the larger of actual and volumetric', () => {
  assert.equal(billableGrams(small), 1500);
  assert.equal(billableGrams({ lengthCm: 50, widthCm: 40, heightCm: 30, grams: 2000 }), 12000);
});

test('zones are found by postal prefix', () => {
  assert.equal(zoneFor('10115').name, 'metro');
  assert.equal(zoneFor('95000').name, 'south');
  assert.equal(zoneFor('ec1a 1bb').name, 'city');
  assert.throws(() => zoneFor('55555'), /55555/);
});

test('a metro line is priced with a fuel surcharge', () => {
  const line = priceLine({ parcel: small, postalCode: '10115' });
  assert.equal(line.baseCents, 555);
  assert.deepEqual(line.surcharges, [{ kind: 'fuel', cents: 47 }]);
  assert.equal(line.totalCents, 602);
});

test('heavy parcels carry the heavy surcharge, light ones do not', () => {
  const heavy = priceLine({ parcel: { ...small, grams: 35000 }, postalCode: '10115' });
  assert.ok(heavy.surcharges.some(extra => extra.kind === 'heavy'));
  const light = priceLine({ parcel: { ...small, grams: 25000 }, postalCode: '10115' });
  assert.ok(!light.surcharges.some(extra => extra.kind === 'heavy'));
});

test('a volume discount reduces the base fee', () => {
  const line = priceLine({ parcel: { ...small, grams: 10000 }, postalCode: '10115', monthlyShipments: 120 });
  assert.equal(line.baseCents, 1150);
  assert.equal(line.discountedBaseCents, 1092);
});

test('a coupon reduces the base fee but not below the minimum', () => {
  assert.equal(priceLine({ parcel: small, postalCode: '10115', couponCents: 100 }).discountedBaseCents, 455);
  assert.equal(priceLine({ parcel: small, postalCode: '10115', couponCents: 5000 }).discountedBaseCents, 250);
});

test('an invoice adds tax', () => {
  const invoice = buildInvoice([{ parcel: small, postalCode: '10115' }]);
  assert.equal(invoice.subtotalCents, 602);
  assert.equal(invoice.taxCents, 114);
  assert.equal(invoice.totalCents, 716);
  assert.throws(() => buildInvoice([]), /at least one line/);
});

test('orders before the cutoff go out the same day, later ones the next day', () => {
  const berlin = { utcOffsetMinutes: 60 };
  assert.equal(dispatchDate('2026-03-10T10:00:00Z', berlin), '2026-03-10');
  assert.equal(dispatchDate('2026-03-10T15:30:00Z', berlin), '2026-03-11');
  assert.equal(dispatchDate('2026-03-13T16:00:00Z', berlin), '2026-03-16');
});
