// spec-audit: a task with nothing to anchor on.
//
// The project's own tests all pass. SPEC.md is a prose specification and the
// implementation violates it in seven independent places. The session is told
// only that the implementation has drifted; not where, and not how often. It is
// graded by one held-out test file per violation plus a regression file for the
// parts that look suspicious but are right, so the score is the number of
// violations actually repaired, not a single pass or fail.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = path.join(here, 'reference');
const heldOut = path.join(here, 'heldout');

// Each mutation turns the correct reference into one spec violation. Building the
// broken project from a correct one guarantees a full-score solution exists.
export const MUTATIONS = [
  { id: 'v1-rounding', file: 'src/money.mjs', spec: '1.2',
    from: `  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  if (remainder * 2 > denominator) return quotient + 1;
  if (remainder * 2 === denominator) return quotient + (quotient % 2);
  return quotient;`,
    to: `  return Math.round(numerator / denominator);` },
  { id: 'v2-weight-step', file: 'src/weight.mjs', spec: '2.3',
    from: 'Math.ceil(heavier / STEP_GRAMS)', to: 'Math.round(heavier / STEP_GRAMS)' },
  { id: 'v3-longest-prefix', file: 'src/zones.mjs', spec: '3.2',
    from: `  let best = null;
  for (const entry of table) {
    if (code.startsWith(entry.prefix) && (!best || entry.prefix.length > best.prefix.length)) best = entry;
  }`,
    to: `  const best = table.find(entry => code.startsWith(entry.prefix));` },
  { id: 'v4-heavy-boundary', file: 'src/surcharge.mjs', spec: '5.2',
    from: 'if (grams >= HEAVY_THRESHOLD_GRAMS)', to: 'if (grams > HEAVY_THRESHOLD_GRAMS)' },
  { id: 'v5-discount-order', file: 'src/discount.mjs', spec: '6.3',
    from: `  const afterVolume = baseCents - basisPoints(baseCents, volumeDiscountBp(monthlyShipments));
  const afterCoupon = afterVolume - couponCents;
  return Math.max(MINIMUM_CENTS, afterCoupon);`,
    to: `  const afterCoupon = baseCents - couponCents;
  const afterVolume = afterCoupon - basisPoints(afterCoupon, volumeDiscountBp(monthlyShipments));
  return Math.max(MINIMUM_CENTS, afterVolume);` },
  { id: 'v6-local-weekday', file: 'src/schedule.mjs', spec: '9.2',
    from: `  let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());`,
    to: `  const utc = new Date(instant);
  let day = Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());` },
  { id: 'v7-tax-per-line', file: 'src/tax.mjs', spec: '8.2',
    from: `  return lines.reduce((sum, line) => sum + basisPoints(line.totalCents, line.zone.taxBp), 0);`,
    to: `  return Math.round(lines.reduce((sum, line) => sum + (line.totalCents * line.zone.taxBp) / 10000, 0));` },
];

export function buildSpecAudit(dest, mutationIds = MUTATIONS.map(m => m.id)) {
  fs.cpSync(reference, dest, { recursive: true });
  for (const mutation of MUTATIONS.filter(m => mutationIds.includes(m.id))) {
    const file = path.join(dest, mutation.file);
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes(mutation.from)) throw new Error(`mutation ${mutation.id} no longer applies to ${mutation.file}`);
    fs.writeFileSync(file, source.replace(mutation.from, mutation.to));
  }
  spawnSync('git', ['init', '-q', dest]);
  spawnSync('git', ['-C', dest, 'add', '-A']);
  spawnSync('git', ['-C', dest, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial']);
}

const runTests = (dir, files) => spawnSync(process.execPath, ['--test', ...files], { cwd: dir, timeout: 120000, encoding: 'utf8' }).status === 0;

// Score = violations repaired. Accepted only when all seven are repaired, the
// project's own tests still pass, the regression file passes, and neither the
// specification nor the visible tests were edited.
export function gradeSpecAudit(dir) {
  const untouched = ['SPEC.md', 'tests/engine.test.mjs'].every(file =>
    fs.existsSync(path.join(dir, file)) && fs.readFileSync(path.join(dir, file), 'utf8') === fs.readFileSync(path.join(reference, file), 'utf8'));
  const visible = runTests(dir, ['tests/engine.test.mjs']);
  const graded = path.join(dir, '.heldout');
  fs.rmSync(graded, { recursive: true, force: true });
  fs.mkdirSync(graded);
  const fixed = [], missed = [];
  let regression = false;
  for (const file of fs.readdirSync(heldOut).sort()) {
    // The held-out files import ../src, so they run from a sibling of src/.
    fs.copyFileSync(path.join(heldOut, file), path.join(graded, file));
    const ok = runTests(dir, [path.join('.heldout', file)]);
    const id = file.replace('.heldout.test.mjs', '');
    if (id === 'zz-regression') regression = ok;
    else (ok ? fixed : missed).push(id);
  }
  fs.rmSync(graded, { recursive: true, force: true });
  const passed = untouched && visible && regression && missed.length === 0;
  return { passed, score: fixed.length, of: fixed.length + missed.length, fixed, missed, regression, visible, untouched,
    stage: passed ? 'passed' : `fixed ${fixed.length}/${fixed.length + missed.length}${regression ? '' : ', regression'}${visible ? '' : ', visible broken'}${untouched ? '' : ', spec or tests edited'}` };
}

export const SPEC_AUDIT_PROMPT = 'SPEC.md is the authoritative specification for this shipping fee engine. The implementation in src/ has drifted from it in several places, even though the existing tests pass. Audit src/ against SPEC.md and fix every deviation in the implementation. Do not change SPEC.md or the existing tests.';
