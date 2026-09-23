#!/usr/bin/env node
// Rebuilds a session-probe report from the cumulative usage files the CLI wrote, when they landed in the
// fixture directory (a run made before session-probe.mjs resolved --out to an absolute path).
//   node experiments/probe-recover.mjs <probe out dir>
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function perModel(usage) {
  const out = {};
  for (const [model, m] of Object.entries(usage?.modelMetrics ?? {})) {
    out[model] = { requests: m.requests?.count ?? 0, input: m.usage?.inputTokens ?? 0, output: m.usage?.outputTokens ?? 0,
      cacheRead: m.usage?.cacheReadTokens ?? 0, cacheWrite: m.usage?.cacheWriteTokens ?? 0, reasoning: m.usage?.reasoningTokens ?? 0,
      credits: (m.totalNanoAiu ?? 0) / 1e9, cacheExpiresAt: m.cacheExpiresAt ?? null };
  }
  return out;
}
const diff = (a, b) => Object.fromEntries(Object.entries(a).map(([m, x]) => [m, Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' ? +(v - (b[m]?.[k] ?? 0)).toFixed(6) : v]))]));
const sessions = [];
for (const name of fs.readdirSync(root)) {
  const report = readJson(path.join(root, name, 'report.json'));
  if (!report?.dir) continue;
  let previous = {};
  for (const t of report.turns) {
    const usageFile = path.join(report.dir, path.relative(process.cwd(), path.join(root, name, `usage-${t.turn}.json`)));
    const alt = path.join(report.dir, 'handoff/raw', path.basename(root), name, `usage-${t.turn}.json`);
    const usage = readJson(usageFile) ?? readJson(alt);
    const cumulative = perModel(usage);
    t.delta = diff(cumulative, previous); previous = cumulative;
    t.credits = +Object.values(t.delta).reduce((s, m) => s + m.credits, 0).toFixed(6);
    t.usageFileFound = Boolean(usage);
  }
  report.credits = +report.turns.reduce((s, t) => s + t.credits, 0).toFixed(6);
  fs.writeFileSync(path.join(root, name, 'report-recovered.json'), `${JSON.stringify(report, null, 2)}\n`);
  sessions.push(report);
}
fs.writeFileSync(path.join(root, 'report-recovered.json'), `${JSON.stringify({ recoveredAt: new Date().toISOString(), sessions }, null, 2)}\n`);
for (const s of sessions) for (const t of s.turns) console.log(`[${s.name}] turn ${t.turn} ${t.model} gap=${t.gapSec}s found=${t.usageFileFound} correct=${t.correct} credits=${t.credits} ` +
  Object.entries(t.delta).map(([m, d]) => `${m}: req=${d.requests} in=${d.input} read=${d.cacheRead} write=${d.cacheWrite} out=${d.output}`).join(' | '));
