#!/usr/bin/env node
// Multi-turn session probe: runs scripted sessions against the benchmark fixture and
// reports what each turn cost on its own, split by model and by cache bucket.
//
// A session is a list of turns. Each turn names a model, a prompt and an optional gap
// (seconds to wait before it is sent). Turns share one --session-id, so the CLI
// resumes the conversation; its usage file is cumulative, so the per-turn figures
// below are differences between consecutive usage files.
//
// Used for two questions:
//   - how long the prompt cache really lives (same session, identical follow-up after a gap)
//   - what switching model mid-session costs (hard turn on one model, easy turn on another)
//
//   node experiments/session-probe.mjs --plan experiments/plans/cache.json --out handoff/raw/probe-cache [--parallel]
//
// Plan file: { "sessions": [ { "name": "...", "turns": [ { "model": "gpt-5.6-luna", "prompt": "...", "gapSec": 0,
//   "reasoningEffort": "xhigh" } ] } ] }
// Prompt strings may name a benchmark scenario instead: "scenario:find-a-value".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { buildFixture } = await import(pathToFileURL(path.join(here, '../shunt-copilot/scripts/benchmark.mjs')).href);

const PROMPTS = {
  'find-a-value': 'In src/delivery-service.mjs, how many times is a delivery retried, how long is the wait between attempts, and which function does the retrying?',
  'mid-size-file': 'In src/pricing-rules.mjs, which SKU has the largest discount, how large is it, and which tiers exist?',
  'summarise-big-file': 'Summarise what src/delivery-service.mjs does. Name the event topics it handles and any function that is not an event handler.',
  'cross-file-question': 'Using src/delivery-service.mjs, src/order-service.mjs and src/user-service.mjs: which OrderService method calls into the delivery service, which delivery function does it call, and which UserService method must pass first?',
};
const CHECKS = {
  'find-a-value': [/\b7\b/, /250/, /retryDelivery/],
  'cross-file-question': [/submitOrder/, /retryDelivery/, /isActive/],
};

function arg(name) { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; }
const planFile = arg('--plan'), outArg = arg('--out');
if (!planFile || !outArg) throw new Error('Usage: session-probe.mjs --plan <file> --out <dir> [--parallel]');
// Absolute: the CLI runs with the fixture as its cwd, so a relative usage path would land there.
const outRoot = path.resolve(outArg);
const parallel = process.argv.includes('--parallel');
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
if (fs.existsSync(outRoot)) throw new Error(`${outRoot} exists; evidence is never overwritten.`);
fs.mkdirSync(outRoot, { recursive: true });
const bin = process.env.SHUNT_COPILOT_BIN || 'copilot';
const tools = ['view', 'rg', 'glob', 'bash', 'apply_patch'];

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function finalAnswer(transcript) {
  try {
    const events = fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
    return events.findLast(e => e.type === 'assistant.message' && e.data?.phase === 'final_answer')?.data?.content ?? '';
  } catch { return ''; }
}

// The copilot launcher execs a child binary; killing only the launcher leaves that child alive holding our stdout pipe,
// so 'close' never fires and a stalled session hangs the whole run. Kill the process group, then drop the pipe.
function killTree(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  child.stdout?.destroy();
}
function runTurn({ dir, prompt, model, sessionId, usageFile, transcript, reasoningEffort, timeoutMs }) {
  const args = ['-C', dir, '-p', prompt, `--session-id=${sessionId}`, '--allow-all-tools', '--allow-all-paths', '--no-custom-instructions',
    '--no-ask-user', '--disable-builtin-mcps', '--output-format', 'json', '--stream', 'off', '--log-level', 'none',
    '--usage-output-file', usageFile, '--model', model, '--available-tools', ...tools];
  if (reasoningEffort) args.push('--reasoning-effort', reasoningEffort);
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd: dir, shell: false, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.pipe(fs.createWriteStream(transcript));
    const timer = setTimeout(() => killTree(child), timeoutMs);
    const done = exitCode => { clearTimeout(timer); resolve({ exitCode, seconds: Math.round((Date.now() - started) / 1000) }); };
    child.on('error', () => done(-1));
    child.on('close', done);
  });
}

// Per-model token/credit figures from a usage file, flattened.
function perModel(usage) {
  const out = {};
  for (const [model, m] of Object.entries(usage?.modelMetrics ?? {})) {
    out[model] = { requests: m.requests?.count ?? 0, input: m.usage?.inputTokens ?? 0, output: m.usage?.outputTokens ?? 0,
      cacheRead: m.usage?.cacheReadTokens ?? 0, cacheWrite: m.usage?.cacheWriteTokens ?? 0, reasoning: m.usage?.reasoningTokens ?? 0,
      credits: (m.totalNanoAiu ?? 0) / 1e9, cacheExpiresAt: m.cacheExpiresAt ?? null };
  }
  return out;
}
function diff(after, before) {
  const out = {};
  for (const [model, a] of Object.entries(after)) {
    const b = before[model] ?? {};
    out[model] = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'number' ? +(v - (b[k] ?? 0)).toFixed(6) : v]));
  }
  return out;
}

async function runSession(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `probe-${spec.name}-`));
  buildFixture(dir);
  const out = path.join(outRoot, spec.name);
  fs.mkdirSync(out, { recursive: true });
  const sessionId = randomUUID();
  const turns = [];
  let previous = {};
  for (const [i, t] of spec.turns.entries()) {
    const prompt = t.prompt.startsWith('scenario:') ? PROMPTS[t.prompt.slice(9)] : t.prompt;
    if (!prompt) throw new Error(`Unknown prompt ${t.prompt}`);
    if (t.gapSec) await sleep(t.gapSec * 1000);
    const usageFile = path.join(out, `usage-${i + 1}.json`), transcript = path.join(out, `transcript-${i + 1}.jsonl`);
    const sentAt = new Date().toISOString();
    const run = await runTurn({ dir, prompt, model: t.model, sessionId, usageFile, transcript, reasoningEffort: t.reasoningEffort, timeoutMs: (t.timeoutSec ?? 900) * 1000 });
    const cumulative = perModel(readJson(usageFile));
    const delta = diff(cumulative, previous);
    previous = cumulative;
    const answer = finalAnswer(transcript);
    const checks = t.prompt.startsWith('scenario:') ? CHECKS[t.prompt.slice(9)] : null;
    const turn = { turn: i + 1, model: t.model, prompt: t.prompt, gapSec: t.gapSec ?? 0, reasoningEffort: t.reasoningEffort ?? null, sentAt, exitCode: run.exitCode,
      seconds: run.seconds, correct: checks ? checks.every(re => re.test(answer)) : null, delta,
      credits: +Object.values(delta).reduce((s, m) => s + m.credits, 0).toFixed(6), answer: answer.slice(0, 600) };
    turns.push(turn);
    console.log(`[${spec.name}] turn ${i + 1} ${t.model} gap=${t.gapSec ?? 0}s credits=${turn.credits} ` +
      Object.entries(delta).map(([m, d]) => `${m}: req=${d.requests} in=${d.input} read=${d.cacheRead} write=${d.cacheWrite} out=${d.output}`).join(' | '));
  }
  const report = { name: spec.name, sessionId, dir, turns, credits: +turns.reduce((s, t) => s + t.credits, 0).toFixed(6) };
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const started = new Date().toISOString();
const reports = parallel ? await Promise.all(plan.sessions.map(runSession)) : [];
if (!parallel) for (const s of plan.sessions) reports.push(await runSession(s));
fs.writeFileSync(path.join(outRoot, 'report.json'), `${JSON.stringify({ plan: planFile, started, finished: new Date().toISOString(), cliVersion: process.env.COPILOT_VERSION ?? null, sessions: reports }, null, 2)}\n`);
console.log(`\nWrote ${path.join(outRoot, 'report.json')}`);
