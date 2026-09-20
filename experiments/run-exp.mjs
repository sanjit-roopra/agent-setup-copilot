#!/usr/bin/env node
// Append-only experiment runner.
//
// Every live run gets its own immutable directory and its own raw JSON file.
// Nothing that already exists is ever overwritten: a duplicate --id/--variant
// pair is refused, not replaced, so the history of what worked and what did not
// stays readable after the fact.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rawDir = path.join(repoRoot, 'handoff/raw');
const runsDir = path.join(repoRoot, 'handoff/runs');
const ledger = path.join(repoRoot, 'experiments/LEDGER.md');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const id = arg('--id');
const variant = arg('--variant');
if (!id || !variant) throw new Error('Usage: run-exp.mjs --id E9b --variant sol-low-effort -- <benchmark arguments>');
if (!/^[A-Za-z0-9-]+$/.test(id) || !/^[A-Za-z0-9-]+$/.test(variant)) throw new Error('--id and --variant take [A-Za-z0-9-] only.');

const separator = process.argv.indexOf('--');
if (separator === -1) throw new Error('Put the benchmark arguments after a bare --.');
const benchArgs = process.argv.slice(separator + 1);
if (benchArgs.some(a => a === '--out')) throw new Error('--out is chosen by this runner so a run cannot overwrite an earlier one.');

const slug = `exp-${id}-${variant}`;
const rawFile = path.join(rawDir, `${slug}.json`);
const outDir = path.join(runsDir, slug);
for (const target of [rawFile, outDir]) {
  if (fs.existsSync(target)) throw new Error(`${target} already exists. Pick a new --variant; evidence is never overwritten.`);
}
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(runsDir, { recursive: true });

const revision = spawnSyncText('git', ['rev-parse', 'HEAD']);
const dirty = spawnSyncText('git', ['status', '--porcelain']);
const cliVersion = spawnSyncText(process.env.SHUNT_COPILOT_BIN || 'copilot', ['--version']);

function spawnSyncText(command, args) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' }).stdout?.trim() ?? '';
}

const started = new Date().toISOString();
const bench = path.join(repoRoot, 'shunt-copilot/scripts/benchmark.mjs');
const child = spawn(process.execPath, [bench, ...benchArgs, '--out', outDir], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'inherit'] });
let stdout = '';
child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
child.on('close', code => {
  const finished = new Date().toISOString();
  const results = fs.existsSync(path.join(outDir, 'results.json'))
    ? JSON.parse(fs.readFileSync(path.join(outDir, 'results.json'), 'utf8')) : null;
  const record = { experiment: id, variant: variant, started, finished, exitCode: code,
    benchmarkArgs: benchArgs, revision, workingTreeDirty: Boolean(dirty), cliVersion, outDir, results };
  fs.writeFileSync(rawFile, `${JSON.stringify(record, null, 2)}\n`);
  const credits = (results?.results ?? []).reduce((sum, r) => sum + (r.total?.nanoAiu ?? 0) / 1e9, 0);
  const correct = (results?.results ?? []).filter(r => r.correct).length;
  const line = `| ${started.slice(0, 19)}Z | ${id} | ${variant} | ${benchArgs.join(' ')} | ${(results?.results ?? []).length} | ${credits.toFixed(3)} | ${correct} | exit ${code} | \`handoff/raw/${slug}.json\` |\n`;
  if (!fs.existsSync(ledger)) {
    fs.writeFileSync(ledger, `# Experiment ledger (append only)

Every live run appends one row here and writes one immutable record to
\`handoff/raw/exp-<id>-<variant>.json\`. Rows are never edited or deleted, so a
failed or inconclusive experiment stays visible next to the ones that worked.

| Started | Exp | Variant | Benchmark arguments | Runs | Credits | Correct runs | Exit | Record |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
`);
  }
  fs.appendFileSync(ledger, line);
  console.log(`\nRecorded: handoff/raw/${slug}.json | ledger row appended | credits this run: ${credits.toFixed(3)}`);
  process.exit(code ?? 1);
});
