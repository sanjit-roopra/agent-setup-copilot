import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceLine } from '../src/line.mjs';

const box = { lengthCm: 10, widthCm: 10, heightCm: 10 };
const hasHeavy = grams => priceLine({ parcel: { ...box, grams }, postalCode: '10115' }).surcharges.some(extra => extra.kind === 'heavy');

test('exactly 30000 g is heavy', () => {
  assert.equal(hasHeavy(30000), true);
});

test('29500 g is not heavy, 30500 g is', () => {
  assert.equal(hasHeavy(29500), false);
  assert.equal(hasHeavy(30500), true);
});
