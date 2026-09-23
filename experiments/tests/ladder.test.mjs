import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ladder, parseCli } from '../ladder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, 'fake-copilot.mjs');
fs.chmodSync(fake, 0o755);

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-repo-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/a.mjs'), 'export const a = "broken";\n');
  fs.writeFileSync(path.join(dir, 'src/b.mjs'), 'export const b = "original";\n');
  spawnSync('git', ['init', '-q', dir]);
  spawnSync('git', ['-C', dir, 'add', '-A']);
  spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init']);
  return dir;
}

function emptyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-empty-'));
  spawnSync('git', ['init', '-q', dir]);
  return dir;
}

async function run(mode, { source = repo(), ...extra } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-out-'));
  process.env.FAKE_MODE = mode;
  process.env.FAKE_LOG = path.join(out, 'strong-calls.log');
  const report = await ladder({ repo: source, task: 'Fix a.', gate: 'grep -q fixed src/a.mjs || ls src/f0.mjs', setup: null, cheap: 'cheap', strong: 'strong',
    tools: ['view'], customInstructions: true, checklist: 'Method.', maxDisputed: 3, fallback: true, out, bin: fake, timeoutMs: 60000, gateTimeoutMs: 60000,
    log: () => {}, ...extra });
  const strongCalls = fs.existsSync(process.env.FAKE_LOG) ? fs.readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { report, out, source, strongCalls, patch: fs.readFileSync(report.patch, 'utf8') };
}

test('agreement plus a green gate is accepted without calling the strong model', async () => {
  const { report, strongCalls, patch, source } = await run('agree');
  assert.match(report.verdict, /^ACCEPTED/);
  assert.equal(strongCalls.length, 0);
  assert.equal(report.credits.total, 2);
  assert.match(patch, /\+export const a = "fixed";/);
  // The user's checkout is never touched, and the patch applies to it cleanly.
  assert.equal(fs.readFileSync(path.join(source, 'src/a.mjs'), 'utf8'), 'export const a = "broken";\n');
  assert.equal(spawnSync('git', ['-C', source, 'apply', '--check', report.patch]).status, 0);
});

test('a dispute sends only the disputed file to the strong model, with the other version alongside', async () => {
  const { report, strongCalls, patch } = await run('dispute');
  assert.match(report.verdict, /^ARBITRATED/);
  assert.deepEqual(report.disputed, ['src/b.mjs']);
  assert.equal(strongCalls.length, 1);
  assert.equal(strongCalls[0].sawOther, true);
  assert.match(strongCalls[0].prompt, /- src\/b\.mjs/);
  assert.doesNotMatch(strongCalls[0].prompt, /- src\/a\.mjs/);
  assert.match(patch, /settled by strong/);
  assert.doesNotMatch(patch, /\.ladder-other/);
  assert.equal(report.credits.total, 11);
});

test('attempts that do not converge fall back to the strong model from scratch, or stop when told to', async () => {
  const fallback = await run('diverge');
  assert.match(fallback.report.verdict, /^STRONG MODEL/);
  assert.equal(fallback.strongCalls[0].attempt, 'strong-solo');
  assert.match(fallback.patch, /strong solo/);
  const stopped = await run('diverge', { fallback: false });
  assert.match(stopped.report.verdict, /^STOPPED/);
  assert.equal(stopped.strongCalls.length, 0);
});

test('a red gate after arbitration asks for a human', async () => {
  const { report } = await run('dispute', { gate: 'false' });
  assert.match(report.verdict, /^NEEDS HUMAN/);
});

test('a repository with no commits yet gets a patch that applies to it', async () => {
  const { report, patch, source } = await run('agree', { source: emptyRepo() });
  assert.match(report.verdict, /^ACCEPTED/);
  assert.match(patch, /\+export const a = "fixed";/);
  assert.equal(spawnSync('git', ['-C', source, 'apply', '--index', report.patch]).status, 0);
  assert.equal(fs.readFileSync(path.join(source, 'src/a.mjs'), 'utf8'), 'export const a = "fixed";\n');
});

test('--compare-strong runs the strong model alone beside the ladder without charging the ladder for it', async () => {
  const { report, strongCalls, out } = await run('agree', { compareStrong: true });
  assert.match(report.verdict, /^ACCEPTED/);
  assert.deepEqual(strongCalls.map(call => call.attempt), ['strong-solo']);
  assert.equal(report.credits.total, 2);
  assert.deepEqual(report.comparison.oneCheapAttempt, { credits: 1, gate: true, seconds: report.comparison.oneCheapAttempt.seconds, files: 1, linesAdded: 1 });
  assert.equal(report.comparison.ladder.credits, 2);
  assert.deepEqual([report.comparison.strongAlone.credits, report.comparison.strongAlone.gate, report.comparison.strongAlone.files], [9, true, 4]);
  assert.match(fs.readFileSync(path.join(out, 'strong-solo.patch'), 'utf8'), /strong solo/);
});

test('a comparison run that falls back pays for the strong model once', async () => {
  const { report, strongCalls } = await run('diverge', { compareStrong: true });
  assert.match(report.verdict, /^STRONG MODEL/);
  assert.equal(strongCalls.length, 1);
  assert.equal(report.credits.strongSolo, 9);
});

test('interpreter caches an attempt leaves behind are neither disputed nor in the patch', async () => {
  const { report, patch, strongCalls } = await run('agree', { gate: 'mkdir -p src/__pycache__ && date +%s%N > src/__pycache__/a.pyc && echo $RANDOM >> src/__pycache__/a.pyc' });
  assert.match(report.verdict, /^ACCEPTED/);
  assert.equal(strongCalls.length, 0);
  assert.doesNotMatch(patch, /__pycache__/);
});

test('--spec-model puts a specification and acceptance tests in front of the attempts and into the patch', async () => {
  const { report, patch, source, out } = await run('agree', { specModel: 'spec', specPrompt: 'Write the spec.', gate: 'sh tests/accept.sh' });
  assert.match(report.verdict, /^ACCEPTED/);
  assert.deepEqual(report.specFiles, ['SPEC.md', 'tests/accept.sh']);
  assert.deepEqual(report.tamperedSpecFiles, []);
  assert.equal(report.credits.total, 3);
  assert.match(fs.readFileSync(path.join(out, 'transcript-attempt-a.jsonl'), 'utf8'), /done by cheap/);
  for (const expected of [/SPEC\.md/, /tests\/accept\.sh/, /\+export const a = "fixed";/]) assert.match(patch, expected);
  assert.equal(spawnSync('git', ['-C', source, 'apply', '--check', report.patch]).status, 0);
});

test('an attempt that weakens the acceptance tests has them restored before the gate runs', async () => {
  const { report, strongCalls } = await run('tamper', { specModel: 'spec', specPrompt: 'Write the spec.', gate: 'sh tests/accept.sh', attempts: 1, fallback: false });
  assert.deepEqual(report.tamperedSpecFiles, ['tests/accept.sh']);
  assert.match(report.verdict, /^STOPPED: the single attempt fails the gate/);
  assert.equal(strongCalls.length, 0);
});

test('a single attempt is accepted on the gate alone and is never compared', async () => {
  const { report, strongCalls, out } = await run('agree', { attempts: 1 });
  assert.match(report.verdict, /^ACCEPTED: the single attempt/);
  assert.equal(report.credits.total, 1);
  assert.equal(strongCalls.length, 0);
  assert.equal(fs.existsSync(path.join(out, 'attempt-b')), false);
});

test('the command line rejects unknown options and missing values', () => {
  assert.deepEqual(parseCli(['--repo', '.', '--dry-run']), { '--repo': '.', '--dry-run': true });
  assert.throws(() => parseCli(['--nope']), /Unknown option/);
  assert.throws(() => parseCli(['--repo']), /needs a value/);
});
