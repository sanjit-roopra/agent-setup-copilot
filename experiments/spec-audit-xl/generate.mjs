// spec-audit-xl: the same audit, at a scale where near-identical things have to be kept apart.
//
// N carriers each ship their own SPEC.md and their own engine.mjs. The engines
// are near-identical, but every rule has two legitimate variants and every
// carrier's specification picks its own, so "what the other carriers do" is never
// evidence of what this carrier should do. A violation is an engine whose variant
// disagrees with its own carrier's specification. Everything is generated from a
// seed, and the grader compares behaviour against an oracle engine generated from
// the specification parameters, so no expected value is written by hand.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const RULES = {
  rounding: ['half-even', 'half-up'],
  step: ['up', 'nearest'],
  prefix: ['longest', 'first'],
  heavy: ['inclusive', 'exclusive'],
  order: ['volume-first', 'coupon-first'],
  calendar: ['local', 'utc'],
  tax: ['per-line', 'subtotal'],
  floor: ['base', 'line'],
  threshold: null, // numeric: heavy threshold in grams
  cutoff: null,    // numeric: cutoff hour
};
export const RULE_IDS = Object.keys(RULES);

const NAMES = ['aster', 'birch', 'cedar', 'dahlia', 'elm', 'fern', 'ginkgo', 'hazel', 'iris', 'juniper', 'kelp', 'larch',
  'maple', 'nettle', 'oak', 'poppy', 'quince', 'rowan', 'sage', 'tansy', 'ulmus', 'violet', 'willow', 'yarrow',
  'zinnia', 'alder', 'briar', 'clover', 'dock', 'elder', 'flax', 'gorse'];

function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const pick = (random, list) => list[Math.floor(random() * list.length)];

export function carrierParams(count, seed) {
  const random = rng(seed);
  return NAMES.slice(0, count).map(name => ({
    name,
    rounding: pick(random, RULES.rounding), step: pick(random, RULES.step), prefix: pick(random, RULES.prefix),
    heavy: pick(random, RULES.heavy), order: pick(random, RULES.order), calendar: pick(random, RULES.calendar),
    tax: pick(random, RULES.tax), floor: pick(random, RULES.floor),
    threshold: pick(random, [20000, 25000, 30000]), cutoff: pick(random, [14, 15, 16, 17]),
    stepGrams: pick(random, [250, 500, 1000]), divisor: pick(random, [4000, 5000, 6000]),
    fuelBp: pick(random, [650, 850, 1050]), heavyCents: pick(random, [1200, 1500, 1800]),
    minimumCents: pick(random, [200, 250, 300]), offsetMinutes: pick(random, [-360, -300, 60, 120, 330, 600]),
    zones: [
      { prefix: '1', name: 'north', baseCents: 400 + Math.floor(random() * 20) * 10, perStepCents: 30 + Math.floor(random() * 8) * 5, taxBp: 1900 },
      { prefix: '9', name: 'south', baseCents: 600 + Math.floor(random() * 20) * 10, perStepCents: 50 + Math.floor(random() * 8) * 5, taxBp: 1900 },
      { prefix: '90', name: 'coast', baseCents: 500 + Math.floor(random() * 20) * 10, perStepCents: 40 + Math.floor(random() * 8) * 5, taxBp: 700 },
      { prefix: '902', name: 'islands', baseCents: 800 + Math.floor(random() * 20) * 10, perStepCents: 70 + Math.floor(random() * 8) * 5, taxBp: 2000 },
    ],
  }));
}

export function flip(params, rule) {
  if (rule === 'threshold') return { ...params, threshold: params.threshold === 30000 ? 25000 : params.threshold + 5000 };
  if (rule === 'cutoff') return { ...params, cutoff: params.cutoff === 17 ? 16 : params.cutoff + 1 };
  const [a, b] = RULES[rule];
  return { ...params, [rule]: params[rule] === a ? b : a };
}

export function engineSource(p) {
  return `// ${p.name} carrier: fee engine. See SPEC.md in this directory.
const STEP_GRAMS = ${p.stepGrams};
const HEAVY_THRESHOLD_GRAMS = ${p.threshold};
const HEAVY_CENTS = ${p.heavyCents};
const FUEL_BP = ${p.fuelBp};
const MINIMUM_CENTS = ${p.minimumCents};
const CUTOFF_MINUTES = ${p.cutoff} * 60;
const WAREHOUSE_OFFSET_MINUTES = ${p.offsetMinutes};
const DAY_MS = 86400000;

const ZONES = ${JSON.stringify(p.zones)};

function divide(numerator, denominator) {
${p.rounding === 'half-even' ? `  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  if (remainder * 2 > denominator) return quotient + 1;
  if (remainder * 2 === denominator) return quotient + (quotient % 2);
  return quotient;` : `  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;`}
}

const share = (cents, bp) => divide(cents * bp, 10000);

export function billableGrams({ lengthCm, widthCm, heightCm, grams }) {
  const volumetric = (lengthCm * widthCm * heightCm * 1000) / ${p.divisor};
  const heavier = Math.max(grams, volumetric);
  return Math.max(STEP_GRAMS, ${p.step === 'up' ? 'Math.ceil' : 'Math.round'}(heavier / STEP_GRAMS) * STEP_GRAMS);
}

export function zoneFor(postalCode) {
  const code = String(postalCode).replace(/\\s+/g, '').toUpperCase();
${p.prefix === 'longest' ? `  let best = null;
  for (const zone of ZONES) if (code.startsWith(zone.prefix) && (!best || zone.prefix.length > best.prefix.length)) best = zone;` : `  const best = ZONES.find(zone => code.startsWith(zone.prefix));`}
  if (!best) throw new Error(\`no zone for postal code \${code}\`);
  return best;
}

function discounted(baseCents, monthlyShipments, couponCents) {
  const bp = monthlyShipments >= 500 ? 1200 : monthlyShipments >= 100 ? 500 : 0;
${p.order === 'volume-first' ? `  const afterVolume = baseCents - share(baseCents, bp);
  return afterVolume - couponCents;` : `  const afterCoupon = Math.max(0, baseCents - couponCents);
  return afterCoupon - share(afterCoupon, bp);`}
}

export function priceLine({ parcel, postalCode, monthlyShipments = 0, couponCents = 0 }) {
  const grams = billableGrams(parcel);
  const zone = zoneFor(postalCode);
  const baseCents = zone.baseCents + zone.perStepCents * (grams / STEP_GRAMS);
  let surchargeCents = share(baseCents, FUEL_BP);
  if (grams ${p.heavy === 'inclusive' ? '>=' : '>'} HEAVY_THRESHOLD_GRAMS) surchargeCents += HEAVY_CENTS;
  const net = discounted(baseCents, monthlyShipments, couponCents);
${p.floor === 'base' ? `  const totalCents = Math.max(MINIMUM_CENTS, net) + surchargeCents;` : `  const totalCents = Math.max(MINIMUM_CENTS, net + surchargeCents);`}
  return { zone: zone.name, taxBp: zone.taxBp, grams, baseCents, totalCents };
}

export function buildInvoice(shipments) {
  const lines = shipments.map(priceLine);
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
${p.tax === 'per-line' ? `  const taxCents = lines.reduce((sum, line) => sum + share(line.totalCents, line.taxBp), 0);` : `  const taxCents = divide(lines.reduce((sum, line) => sum + line.totalCents * line.taxBp, 0), 10000);`}
  return { lines, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export function dispatchDate(orderedAtIso) {
  const instant = Date.parse(orderedAtIso);
  const local = new Date(instant + WAREHOUSE_OFFSET_MINUTES * 60000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const calendar = ${p.calendar === 'local' ? 'local' : 'new Date(instant)'};
  let day = Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), calendar.getUTCDate());
  if (minutes >= CUTOFF_MINUTES) day += DAY_MS;
  while ([0, 6].includes(new Date(day).getUTCDay())) day += DAY_MS;
  return new Date(day).toISOString().slice(0, 10);
}
`;
}

export function specSource(p) {
  const sign = p.offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(p.offsetMinutes);
  const offset = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `# ${p.name} carrier: fee specification

This document is authoritative for the ${p.name} carrier only. Other carriers have
their own contracts and their own rules; nothing here applies to them and nothing
of theirs applies here. Money is integer cents, weight is integer grams,
timestamps are UTC.

1. **Rounding.** Fractions of a cent are rounded to the nearest cent. An exact half
   cent is rounded ${p.rounding === 'half-even' ? 'to the nearest even cent (110.5 becomes 110, 111.5 becomes 112)' : 'up, away from zero (110.5 becomes 111, 111.5 becomes 112)'}.
2. **Billable weight.** Volumetric weight is the volume in cubic centimetres divided
   by ${p.divisor}, in kilograms. The billable weight is the larger of actual and
   volumetric weight, ${p.step === 'up' ? `rounded up to the next multiple of ${p.stepGrams} grams` : `rounded to the nearest multiple of ${p.stepGrams} grams, a half step rounding up`}, and never less than ${p.stepGrams} grams.
3. **Zones.** The zone comes from the postal code prefix, after removing spaces. When
   several prefixes match, ${p.prefix === 'longest' ? 'the longest matching prefix decides, whatever the order of the table' : 'the first matching entry in table order decides; the contract lists broader regions first on purpose'}.
4. **Base fee.** Zone base fee plus the zone's fee per ${p.stepGrams} gram step of billable weight.
5. **Fuel surcharge.** ${(p.fuelBp / 100).toFixed(1)} percent of the undiscounted base fee, rounded by rule 1.
6. **Heavy surcharge.** ${p.heavyCents} cents for a parcel whose billable weight is ${p.heavy === 'inclusive' ? `${p.threshold} grams or more` : `more than ${p.threshold} grams; a parcel of exactly ${p.threshold} grams does not carry it`}.
7. **Discounts.** 100 or more monthly shipments earn 5 percent off the base fee, 500 or
   more earn 12 percent. A coupon takes a fixed number of cents off the base fee.
   ${p.order === 'volume-first' ? 'The percentage is computed on the full base fee and subtracted first; the coupon is subtracted afterwards' : 'The coupon is subtracted first, never taking the base fee below zero; the percentage is then computed on what remains'}.
8. **Minimum charge.** ${p.floor === 'base' ? `The discounted base fee is never below ${p.minimumCents} cents; surcharges are added on top of that floor` : `The line total, surcharges included, is never below ${p.minimumCents} cents; the floor applies to the whole line, not to the base fee alone`}.
9. **Tax.** Each zone has a tax rate in basis points. ${p.tax === 'per-line' ? 'Tax is rounded per line and the invoice tax is the sum of the per-line taxes' : 'Tax is computed once on the invoice: the unrounded per-line taxes are added up and the sum is rounded once'}.
10. **Dispatch.** The warehouse clock is fixed at ${offset}. An order placed at or after
    ${p.cutoff}:00 on the warehouse clock is dispatched the next day, otherwise the same day.
    Weekends are skipped forward to Monday. The calendar day and the day of the week
    are taken from ${p.calendar === 'local' ? 'the warehouse clock' : 'the UTC calendar, because the dispatch system of this carrier runs on UTC; only the cutoff uses the warehouse clock'}.
`;
}

// --- probes: inputs on which one rule, and only that rule, changes the output ---

const box = { lengthCm: 10, widthCm: 10, heightCm: 10 };
function pool(p) {
  const weights = [1, 120, 125, 130, 370, 375, 380, p.threshold - 1000, p.threshold - p.stepGrams, p.threshold, p.threshold + p.stepGrams,
    p.threshold + 5000, 40000, ...Array.from({ length: 40 }, (_, k) => (k + 1) * p.stepGrams),
    ...Array.from({ length: 12 }, (_, k) => Math.round((k + 1.3) * p.stepGrams)), ...Array.from({ length: 12 }, (_, k) => Math.round((k + 1.7) * p.stepGrams))];
  const lines = [];
  for (const grams of weights) for (const postalCode of ['10115', '95000', '90500', '90210'])
    for (const [monthlyShipments, couponCents] of [[0, 0], [120, 0], [0, 150], [120, 150], [600, 300], [0, 5000], [600, 5000]])
      lines.push({ parcel: { ...box, grams }, postalCode, monthlyShipments, couponCents });
  const calls = lines.map(line => ['priceLine', [line]]);
  // Undiscounted lines only, so an invoice isolates the tax rule from the discount rules.
  const plain = lines.filter(line => line.monthlyShipments === 0 && line.couponCents === 0 && line.parcel.grams < p.threshold - 1000
    && line.parcel.grams % p.stepGrams === 0 && ['10115', '95000'].includes(line.postalCode));
  for (let i = 0; i + 2 < plain.length; i++) calls.push(['buildInvoice', [[plain[i], plain[i + 1], plain[i + 2]]]]);
  for (const day of ['2026-03-09', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15'])
    for (let hour = 0; hour < 24; hour++) for (const minute of ['00', '30']) calls.push(['dispatchDate', [`${day}T${String(hour).padStart(2, '0')}:${minute}:00Z`]]);
  return calls;
}

// The inclusive/exclusive rule only shows at the exact threshold, where the threshold value itself also matters.
const COUPLED = { heavy: ['threshold'] };

async function load(source, dir, tag) {
  const file = path.join(dir, `engine-${tag}.mjs`);
  fs.writeFileSync(file, source);
  return import(`${new URL(`file://${file}`).href}?${tag}`);
}
const call = (engine, [fn, args]) => { try { return JSON.stringify(engine[fn](...args)); } catch (error) { return `throw:${error.message}`; } };

// For every rule: probes where flipping that rule changes the output and flipping any other single rule does not.
export async function probesFor(p, scratch) {
  const correct = await load(engineSource(p), scratch, `${p.name}-ok`);
  const flipped = {};
  for (const rule of RULE_IDS) flipped[rule] = await load(engineSource(flip(p, rule)), scratch, `${p.name}-${rule}`);
  const calls = pool(p);
  const expected = calls.map(c => call(correct, c));
  const differs = Object.fromEntries(RULE_IDS.map(rule => [rule, calls.map((c, i) => call(flipped[rule], c) !== expected[i])]));
  const probes = {};
  for (const rule of RULE_IDS) {
    probes[rule] = calls.map((c, i) => ({ c, i })).filter(({ i }) => differs[rule][i] && RULE_IDS.every(other => other === rule || (COUPLED[rule] ?? []).includes(other) || !differs[other][i]))
      .slice(0, 12).map(({ c, i }) => ({ call: c, expected: expected[i] }));
  }
  const neutral = calls.map((c, i) => ({ c, i })).filter(({ i }) => RULE_IDS.every(rule => !differs[rule][i])).map(({ c, i }) => ({ call: c, expected: expected[i] }));
  return { probes, neutral };
}

export function visibleTest(p, neutral) {
  const chosen = ['priceLine', 'buildInvoice', 'dispatchDate'].flatMap(fn => neutral.filter(n => n.call[0] === fn).slice(0, 3));
  return `import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as engine from '../engine.mjs';

${chosen.map((n, i) => `test('${p.name} ${n.call[0]} case ${i + 1}', () => {
  assert.deepEqual(engine.${n.call[0]}(...${JSON.stringify(n.call[1])}), ${n.expected.startsWith('"') ? n.expected : n.expected});
});`).join('\n\n')}
`;
}

export const XL_PROMPT = 'Every directory under carriers/ holds one carrier: its authoritative SPEC.md, its engine.mjs and a passing test. Some engines have drifted from their own SPEC.md. The carriers legitimately differ from each other, so judge each engine only against the SPEC.md next to it. Audit every carrier, fix every deviation in the engines, and do not change any SPEC.md or any test.';

export async function buildXl(dest, { carriers = 24, violations = 14, seed = 7 } = {}) {
  const params = carrierParams(carriers, seed);
  const random = rng(seed + 1);
  const pairs = params.flatMap(p => RULE_IDS.map(rule => ({ carrier: p.name, rule })));
  const planted = [];
  while (planted.length < violations) {
    const candidate = pick(random, pairs);
    // At most two per carrier, and some carriers stay clean, so "every engine has one bug" is not a usable prior.
    if (planted.some(v => v.carrier === candidate.carrier && v.rule === candidate.rule)) continue;
    if (planted.filter(v => v.carrier === candidate.carrier).length >= 2) continue;
    planted.push(candidate);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-scratch-'));
  for (const p of params) {
    const dir = path.join(dest, 'carriers', p.name);
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    let broken = p;
    for (const v of planted.filter(v => v.carrier === p.name)) broken = flip(broken, v.rule);
    fs.writeFileSync(path.join(dir, 'SPEC.md'), specSource(p));
    fs.writeFileSync(path.join(dir, 'engine.mjs'), engineSource(broken));
    const { neutral } = await probesFor(p, scratch);
    fs.writeFileSync(path.join(dir, 'tests', `${p.name}.test.mjs`), visibleTest(p, neutral));
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.writeFileSync(path.join(dest, 'README.md'), '# Carrier fee engines\n\nOne directory per carrier under `carriers/`. Run every test with `node --test carriers/*/tests/*.test.mjs`.\n');
  spawnSync('git', ['init', '-q', dest]);
  spawnSync('git', ['-C', dest, 'add', '-A']);
  spawnSync('git', ['-C', dest, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial']);
  return { params, planted };
}

// Differential grading: every (carrier, rule) pair is compared with an oracle engine generated from the specification parameters.
export async function gradeXl(dir, { carriers = 24, violations = 14, seed = 7 } = {}) {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-grade-'));
  const reference = path.join(probeDir, 'reference');
  const { params, planted } = await buildXl(reference, { carriers, violations, seed });
  const fixed = [], missed = [], regressions = [];
  let untouched = true;
  for (const p of params) {
    for (const file of ['SPEC.md', `tests/${p.name}.test.mjs`]) {
      const a = path.join(dir, 'carriers', p.name, file), b = path.join(reference, 'carriers', p.name, file);
      if (!fs.existsSync(a) || fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8')) untouched = false;
    }
    const { probes } = await probesFor(p, probeDir);
    let engine = null;
    try { engine = await import(`${new URL(`file://${path.join(dir, 'carriers', p.name, 'engine.mjs')}`).href}?graded=${Date.now()}`); } catch { /* every rule of this carrier counts as wrong */ }
    for (const rule of RULE_IDS) {
      const ok = engine !== null && probes[rule].length > 0 && probes[rule].every(probe => call(engine, probe.call) === probe.expected);
      const wasPlanted = planted.some(v => v.carrier === p.name && v.rule === rule);
      if (wasPlanted) (ok ? fixed : missed).push(`${p.name}:${rule}`);
      else if (!ok) regressions.push(`${p.name}:${rule}`);
    }
  }
  fs.rmSync(probeDir, { recursive: true, force: true });
  const passed = untouched && missed.length === 0 && regressions.length === 0;
  return { passed, score: fixed.length, of: planted.length, fixed, missed, regressions, regression: regressions.length === 0, untouched,
    stage: passed ? 'passed' : `fixed ${fixed.length}/${planted.length}, ${regressions.length} regressions${untouched ? '' : ', spec or tests edited'}` };
}
