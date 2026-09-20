import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zoneFor } from '../src/zones.mjs';

test('the longest prefix wins whatever the table order', () => {
  assert.equal(zoneFor('90210').name, 'islands');
  assert.equal(zoneFor('90500').name, 'coast');
  assert.equal(zoneFor('95000').name, 'south');
  assert.equal(zoneFor('E1 6AN').name, 'east');
  assert.equal(zoneFor('ec1a 1bb').name, 'city');
});

test('a custom table in any order behaves the same', () => {
  const zone = name => ({ name });
  const table = [{ prefix: 'A', zone: zone('short') }, { prefix: 'ABC', zone: zone('long') }, { prefix: 'AB', zone: zone('mid') }];
  assert.equal(zoneFor('ABCD', table).name, 'long');
  assert.equal(zoneFor('ABX', table).name, 'mid');
  assert.equal(zoneFor('AX', [...table].reverse()).name, 'short');
});
