import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceLine } from '../src/line.mjs';
import { buildInvoice } from '../src/invoice.mjs';
import { dispatchDate } from '../src/schedule.mjs';
import { billableGrams, volumetricGrams } from '../src/weight.mjs';
import { discountedBase } from '../src/discount.mjs';
import { surcharges } from '../src/surcharge.mjs';

// Things that are correct in the original and must still be correct after the audit.
test('volumetric weight is volume / 5000 kg', () => {
  assert.equal(volumetricGrams({ lengthCm: 50, widthCm: 40, heightCm: 30 }), 12000);
});

test('limits and rejections are intact', () => {
  assert.throws(() => billableGrams({ lengthCm: 10, widthCm: 10, heightCm: 10, grams: 70600 }), RangeError);
  assert.throws(() => billableGrams({ lengthCm: 0, widthCm: 10, heightCm: 10, grams: 100 }), RangeError);
  assert.throws(() => discountedBase({ baseCents: 1000, couponCents: -1 }), RangeError);
});

test('exactly 16:00 local is after the cutoff, and Friday evening goes to Monday', () => {
  assert.equal(dispatchDate('2026-03-10T15:00:00Z', { utcOffsetMinutes: 60 }), '2026-03-11');
  assert.equal(dispatchDate('2026-03-10T14:59:00Z', { utcOffsetMinutes: 60 }), '2026-03-10');
  assert.equal(dispatchDate('2026-03-13T17:00:00Z', { utcOffsetMinutes: 0 }), '2026-03-16');
});

test('surcharges sit on top of the minimum charge and use the undiscounted base', () => {
  const line = priceLine({ parcel: { lengthCm: 10, widthCm: 10, heightCm: 10, grams: 1300 }, postalCode: '95000', couponCents: 9999 });
  assert.equal(line.baseCents, 815);
  assert.equal(line.discountedBaseCents, 250);
  assert.deepEqual(line.surcharges, [{ kind: 'fuel', cents: 69 }]);
  assert.equal(line.totalCents, 319);
});

test('a remote zone adds the flat remote surcharge after the fuel surcharge', () => {
  assert.deepEqual(surcharges({ baseCents: 1140, grams: 1500, zone: { remote: true } }), [{ kind: 'fuel', cents: 97 }, { kind: 'remote', cents: 700 }]);
});

test('a two-line invoice adds up', () => {
  const invoice = buildInvoice([
    { parcel: { lengthCm: 10, widthCm: 10, heightCm: 10, grams: 1300 }, postalCode: '10115' },
    { parcel: { lengthCm: 10, widthCm: 10, heightCm: 10, grams: 1300 }, postalCode: '95000' },
  ]);
  assert.equal(invoice.subtotalCents, 1486);
  assert.equal(invoice.taxCents, 282);
  assert.equal(invoice.totalCents, 1768);
});
