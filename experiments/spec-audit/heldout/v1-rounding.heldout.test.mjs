import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divideHalfEven, basisPoints } from '../src/money.mjs';
import { priceLine } from '../src/line.mjs';

test('ties go to the even cent', () => {
  assert.equal(divideHalfEven(1105, 10), 110);
  assert.equal(divideHalfEven(1115, 10), 112);
  assert.equal(divideHalfEven(5, 10), 0);
  assert.equal(divideHalfEven(15, 10), 2);
  assert.equal(basisPoints(1300, 850), 110);
});

test('non-ties still round to nearest', () => {
  assert.equal(divideHalfEven(1104, 10), 110);
  assert.equal(divideHalfEven(1106, 10), 111);
});

test('the fuel surcharge on a 1300 cent base is 110, not 111', () => {
  const line = priceLine({ parcel: { lengthCm: 10, widthCm: 10, heightCm: 10, grams: 7500 }, postalCode: '95000' });
  assert.equal(line.baseCents, 1475);
  const metro = priceLine({ parcel: { lengthCm: 10, widthCm: 10, heightCm: 10, grams: 12500 }, postalCode: '10115' });
  assert.equal(metro.baseCents, 1325);
  const city = priceLine({ parcel: { lengthCm: 10, widthCm: 10, heightCm: 10, grams: 10000 }, postalCode: 'EC1A' });
  assert.equal(city.baseCents, 1300);
  assert.equal(city.surcharges[0].cents, 110);
});
