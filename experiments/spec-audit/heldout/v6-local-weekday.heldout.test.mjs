import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchDate } from '../src/schedule.mjs';

test('the calendar day and weekday are the warehouse local ones', () => {
  // Friday 23:30 UTC is Saturday 01:30 in a +02:00 warehouse: before the cutoff, on a Saturday.
  assert.equal(dispatchDate('2026-03-13T23:30:00Z', { utcOffsetMinutes: 120 }), '2026-03-16');
  // Monday 02:00 UTC is Sunday 20:00 in a -06:00 warehouse: after the cutoff, on a Sunday.
  assert.equal(dispatchDate('2026-03-16T02:00:00Z', { utcOffsetMinutes: -360 }), '2026-03-16');
  // Tuesday 23:00 UTC is Wednesday 09:00 in a +10:00 warehouse.
  assert.equal(dispatchDate('2026-03-10T23:00:00Z', { utcOffsetMinutes: 600 }), '2026-03-11');
  // Sunday 22:30 UTC is Monday 00:30 in a +02:00 warehouse: a working day already.
  assert.equal(dispatchDate('2026-03-15T22:30:00Z', { utcOffsetMinutes: 120 }), '2026-03-16');
});
