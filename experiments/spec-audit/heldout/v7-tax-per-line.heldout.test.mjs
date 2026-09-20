import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceTax } from '../src/tax.mjs';

const zone = taxBp => ({ taxBp });

test('tax is rounded per line and then summed', () => {
  // 19% of 103 is 19.57 -> 20 per line, 60 for three lines. 19% of 309 is 58.71 -> 59.
  assert.equal(invoiceTax([103, 103, 103].map(totalCents => ({ totalCents, zone: zone(1900) }))), 60);
  // 19% of 102 is 19.38 -> 19 per line, 57 in total. 19% of 306 is 58.14 -> 58.
  assert.equal(invoiceTax([102, 102, 102].map(totalCents => ({ totalCents, zone: zone(1900) }))), 57);
});

test('each line uses the rate of its own zone', () => {
  assert.equal(invoiceTax([{ totalCents: 1000, zone: zone(1900) }, { totalCents: 1000, zone: zone(700) }]), 260);
});
