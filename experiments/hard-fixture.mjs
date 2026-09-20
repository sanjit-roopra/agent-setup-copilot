// Fixtures for tasks a cheap model is expected to get wrong.
//
// Each one has the same shape: a visible failing test that states the symptom, a
// root cause in a different file from the symptom, and a held-out test that the
// model never sees. The held-out test is what separates a real fix from a fix
// that special-cases the one input the visible test happens to name. Without it,
// "the failing test passes now" is not evidence that the task was understood.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// --- H1: the symptom is in billing, the bug is in the calendar helper ---------

const CALENDAR = `// Date helpers shared by billing and reporting.

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days from start up to but NOT including end. A half-open window. */
export function daysInWindow(start, end) {
  const ms = Date.UTC(end.y, end.m - 1, end.d) - Date.UTC(start.y, start.m - 1, start.d);
  return Math.round(ms / 86400000);
}

/** How many days the given month has, 1-indexed month. */
export function daysInMonth(y, m) {
  return MONTH_LENGTHS[m - 1];
}

/** Formats a date for a line on the invoice. */
export function formatDate({ y, m, d }) {
  return \`\${y}-\${String(m).padStart(2, '0')}-\${String(d).padStart(2, '0')}\`;
}
`;

// Nothing in billing.mjs is wrong. The proration arithmetic is correct for every
// month whose length daysInMonth() reports correctly, which is the point: the
// failing invoice is produced in this file but caused in calendar.mjs.
const BILLING = `import { daysInWindow, daysInMonth, formatDate } from './calendar.mjs';

export const MONTHLY_RATE_CENTS = 3000;

/**
 * Prorates one month of subscription for a customer who was active from
 * \`from\` up to and including \`to\`. Both dates are inclusive.
 */
export function prorate(from, to) {
  if (from.y !== to.y || from.m !== to.m) throw new Error('prorate handles one calendar month at a time');
  const days = daysInWindow(from, to) + 1;
  return Math.round((MONTHLY_RATE_CENTS * days) / daysInMonth(from.y, from.m));
}

/** Sums prorated charges for every period on the invoice. */
export function invoiceTotal(periods) {
  return periods.reduce((sum, period) => sum + prorate(period.from, period.to), 0);
}

/** One human-readable line per period, for the printed invoice. */
export function invoiceLines(periods) {
  return periods.map(period => \`\${formatDate(period.from)}..\${formatDate(period.to)} \${prorate(period.from, period.to)}\`);
}
`;

// The visible suite fails on exactly one test, and it names February 2024.
// Special-casing that month, or testing y % 4 === 0, passes here and fails the
// held-out suite.
const BILLING_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prorate, invoiceTotal, MONTHLY_RATE_CENTS } from '../src/billing.mjs';

test('a full mid-month window is prorated by day count', () => {
  assert.equal(prorate({ y: 2026, m: 4, d: 10 }, { y: 2026, m: 4, d: 19 }), 1000);
});

test('a single day costs one day of the month', () => {
  assert.equal(prorate({ y: 2026, m: 4, d: 10 }, { y: 2026, m: 4, d: 10 }), 100);
});

test('a whole ordinary February costs exactly the monthly rate', () => {
  assert.equal(prorate({ y: 2026, m: 2, d: 1 }, { y: 2026, m: 2, d: 28 }), MONTHLY_RATE_CENTS);
});

test('a whole leap February costs exactly the monthly rate', () => {
  assert.equal(prorate({ y: 2024, m: 2, d: 1 }, { y: 2024, m: 2, d: 29 }), MONTHLY_RATE_CENTS);
});

test('invoiceTotal sums its periods', () => {
  assert.equal(invoiceTotal([
    { from: { y: 2026, m: 4, d: 10 }, to: { y: 2026, m: 4, d: 19 } },
    { from: { y: 2026, m: 4, d: 20 }, to: { y: 2026, m: 4, d: 20 } },
  ]), 1100);
});
`;

// Never written into the project. Applied by the check after the session ends.
// 1900 is the trap for a y % 4 === 0 fix: divisible by 100 but not 400, so it is
// not a leap year. 2000 is divisible by 400, so it is.
const BILLING_HELD_OUT = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prorate, MONTHLY_RATE_CENTS } from '../src/billing.mjs';
import { daysInMonth } from '../src/calendar.mjs';

const FEBRUARIES = [[2024, 29], [2026, 28], [2028, 29], [2000, 29], [1900, 28], [2100, 28]];

for (const [y, last] of FEBRUARIES) {
  test(\`daysInMonth reports February \${y} correctly\`, () => {
    assert.equal(daysInMonth(y, 2), last);
  });
  test(\`a whole February \${y} costs exactly the monthly rate\`, () => {
    assert.equal(prorate({ y, m: 2, d: 1 }, { y, m: 2, d: last }), MONTHLY_RATE_CENTS);
  });
}

test('every other month is still reported correctly', () => {
  for (const [m, length] of [[1, 31], [3, 31], [4, 30], [6, 30], [9, 30], [12, 31]]) {
    assert.equal(daysInMonth(2024, m), length, \`month \${m}\`);
  }
});

test('mid-month windows are unchanged by the fix', () => {
  assert.equal(prorate({ y: 2026, m: 4, d: 10 }, { y: 2026, m: 4, d: 19 }), 1000);
  assert.equal(prorate({ y: 2024, m: 2, d: 1 }, { y: 2024, m: 2, d: 15 }), 1552);
});
`;

// --- H2: an invariant that only holds if every caller is found ---------------

const REGISTRY = `// Handlers are looked up by name, including names built at run time.
const handlers = new Map();

export function register(name, handler) {
  if (handlers.has(name)) throw new Error(\`duplicate handler: \${name}\`);
  handlers.set(name, handler);
  return handler;
}

export function dispatch(name, payload) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(\`no handler registered for \${name}\`);
  return handler(payload);
}

export function registered() { return [...handlers.keys()]; }
`;

const PIPELINE = `import { register, dispatch } from './registry.mjs';

export const STAGES = ['ingest', 'validate', 'transform', 'emit'];

register('ingest', payload => ({ ...payload, seen: true }));
register('validate', payload => {
  if (!payload.seen) throw new Error('validate ran before ingest');
  return { ...payload, valid: typeof payload.id === 'string' };
});
register('transform', payload => ({ ...payload, id: String(payload.id).trim().toLowerCase() }));
register('emit', payload => ({ ...payload, emitted: true }));

/** Runs every stage in order. The stage name is built at run time, not written literally. */
export function run(payload) {
  return STAGES.reduce((current, stage) => dispatch(stage, current), payload);
}

/** Runs one stage by index, also building the name at run time. */
export function runStage(index, payload) {
  return dispatch(STAGES[index], payload);
}
`;

const PIPELINE_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run, STAGES } from '../src/pipeline.mjs';
import { registered } from '../src/registry.mjs';

test('every stage is registered', () => {
  for (const stage of STAGES) assert.ok(registered().includes(stage), \`\${stage} is not registered\`);
});

test('run walks the whole pipeline', () => {
  assert.deepEqual(run({ id: '  ABC  ' }), { id: 'abc', seen: true, valid: true, emitted: true });
});
`;

const PIPELINE_HELD_OUT = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run, runStage, STAGES } from '../src/pipeline.mjs';
import { registered, dispatch } from '../src/registry.mjs';

test('stage names and registered names still agree after the rename', () => {
  assert.deepEqual([...STAGES].sort(), [...registered()].sort());
});

test('runStage resolves every index', () => {
  const payload = { id: 'x', seen: true };
  for (let i = 1; i < STAGES.length; i++) assert.doesNotThrow(() => runStage(i, payload));
});

test('dispatch still refuses an unknown name', () => {
  assert.throws(() => dispatch('nope', {}), /no handler registered/);
});

test('the pipeline still produces the same result', () => {
  assert.deepEqual(run({ id: '  ABC  ' }), { id: 'abc', seen: true, valid: true, emitted: true });
});
`;

function write(dest, files) {
  fs.mkdirSync(path.join(dest, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'tests'), { recursive: true });
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dest, file), content);
  spawnSync('git', ['init', '-q', dest]);
}

export const HELD_OUT = {
  'hard-debug': { 'tests/billing.heldout.test.mjs': BILLING_HELD_OUT },
  'hard-refactor': { 'tests/pipeline.heldout.test.mjs': PIPELINE_HELD_OUT },
};

export function buildHardDebug(dest) {
  write(dest, { 'src/calendar.mjs': CALENDAR, 'src/billing.mjs': BILLING, 'tests/billing.test.mjs': BILLING_TEST });
}

export function buildHardRefactor(dest) {
  write(dest, { 'src/registry.mjs': REGISTRY, 'src/pipeline.mjs': PIPELINE, 'tests/pipeline.test.mjs': PIPELINE_TEST });
}

// Runs the project's own tests, then adds the held-out tests and runs everything.
// Both have to pass: the visible suite proves nothing was broken, the held-out
// suite proves the fix generalises beyond the one case the task named.
export function checkWithHeldOut(name, dir) {
  // Enumerate the files rather than passing a directory: `node --test tests/`
  // resolves that argument as a module, not as a set of test files.
  const suite = () => fs.readdirSync(path.join(dir, 'tests')).filter(file => file.endsWith('.test.mjs')).map(file => `tests/${file}`);
  const run = () => spawnSync(process.execPath, ['--test', ...suite()], { cwd: dir, timeout: 120000, encoding: 'utf8' });
  const visible = run();
  if (visible.status !== 0) return { passed: false, stage: 'visible-failed', output: visible.stdout ?? '' };
  for (const [file, content] of Object.entries(HELD_OUT[name] ?? {})) {
    fs.writeFileSync(path.join(dir, file), content);
  }
  const all = run();
  return { passed: all.status === 0, stage: all.status === 0 ? 'passed' : 'held-out-failed', output: all.stdout ?? '' };
}
