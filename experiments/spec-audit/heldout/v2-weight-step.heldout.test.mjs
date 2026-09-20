import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billableGrams } from '../src/weight.mjs';

const box = { lengthCm: 10, widthCm: 10, heightCm: 10 };

test('billable weight always rounds up to the next 500 g', () => {
  assert.equal(billableGrams({ ...box, grams: 1100 }), 1500);
  assert.equal(billableGrams({ ...box, grams: 1001 }), 1500);
  assert.equal(billableGrams({ ...box, grams: 501 }), 1000);
  assert.equal(billableGrams({ ...box, grams: 1 }), 500);
});

test('exact multiples are unchanged', () => {
  assert.equal(billableGrams({ ...box, grams: 1500 }), 1500);
  assert.equal(billableGrams({ ...box, grams: 70000 }), 70000);
});

test('volumetric weight rounds up too', () => {
  assert.equal(billableGrams({ lengthCm: 30, widthCm: 20, heightCm: 10, grams: 100 }), 1500);
});
