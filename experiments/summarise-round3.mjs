#!/usr/bin/env node
// Prints the round-3 comparison tables from the raw result files. Reads only; spends nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const raw = f => path.join(root, 'handoff/raw', f);
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const f2 = n => (n == null ? 'n/a' : Number(n).toFixed(2));
const lines = [];
const say = s => lines.push(s);

// T1: spec-audit-xl, per-run credits and correctness, new Luna effort levels against the earlier arms.
say('## T1/T6 spec-audit-xl: reasoning effort vs earlier arms (3 runs each unless noted; "default" = high, the account setting)\n');
say('| Arm | Runs | Correct | Credits/run | Mean | Reasoning tokens/run | Calls/run | Record |');
say('| --- | ---: | ---: | --- | ---: | --- | --- | --- |');
const xlArms = [
  ['Sol default', 'exp-H4-sol-spec-audit-xl-3.json'], ['Terra default', 'exp-H4-terra-xl-3b.json'],
  ['Luna default', 'exp-H4-luna-spec-audit-xl-2.json'], ['Luna default (run 1b)', 'exp-H4-luna-spec-audit-xl-1b.json'],
  ['Luna + checklist prompt', 'exp-H4-luna-checklist-xl-3b.json'],
  ['Ladder (2 Luna + Sol arbiter) + checklist', 'exp-L1-ladder-checklist-xl-3.json'],
  ['**Luna xhigh (new)**', 'exp-T1-luna-xhigh-xl-3.json'], ['**Luna max (new)**', 'exp-T1-luna-max-xl-3.json'],
  ['**Sol low (new)**', 'exp-T7-sol-low-xl-3.json'], ['**Sol medium (new; run 3 stalled, 0 credits, counted wrong)**', 'exp-T7-sol-medium-xl-3.json'],
  ['**Terra xhigh (new)**', 'exp-T6-terra-xhigh-xl-3.json'], ['**Terra max (new)**', 'exp-T6-terra-max-xl-3.json'],
];
for (const [label, file] of xlArms) {
  const r = readJson(raw(file))?.results?.results ?? [];
  if (!r.length) { say(`| ${label} | 0 | | not run / failed | | | | \`${file}\` |`); continue; }
  const credits = r.map(x => x.total.nanoAiu / 1e9);
  say(`| ${label} | ${r.length} | ${r.filter(x => x.correct).length}/${r.length} | ${credits.map(f2).join(' / ')} | ${f2(credits.reduce((a, b) => a + b, 0) / r.length)} | ${r.map(x => x.main?.reasoning ?? 0).join(' / ')} | ${r.map(x => x.main?.modelCalls ?? 0).join(' / ')} | \`${file}\` |`);
}

// T1b: Pong one-liner with Luna xhigh, one attempt, against the earlier one-liner builds.
say('\n## T1b Pong one-liner: Luna xhigh vs earlier builds (one run each)\n');
say('| Arm | Credits | Gate | tty-smoke | Python lines | Source |');
say('| --- | ---: | --- | --- | ---: | --- |');
const pong2 = readJson(raw('greenfield/pong2-luna-vs-sol-one-liner/report.json'));
say(`| Luna default, 1 attempt | ${f2(pong2?.credits?.attemptA)} | ${pong2?.comparison?.oneCheapAttempt?.gate} | pass (owner round 2) | ${pong2?.comparison?.oneCheapAttempt?.linesAdded} | pong2 |`);
say(`| Sol alone | ${f2(pong2?.comparison?.strongAlone?.credits)} | ${pong2?.comparison?.strongAlone?.gate} | pass (round 2) | ${pong2?.comparison?.strongAlone?.linesAdded} | pong2 |`);
const xh = readJson(path.join(os.homedir(), 'scratch/t1-pong-xhigh-out/report.json'));
const xhGate = readJson(path.join(os.homedir(), 'scratch/t1-pong-xhigh-out/gate.json'));
say(`| **Luna xhigh, 1 attempt (new)** | ${f2(xh?.credits?.attemptA)} | ${xh?.comparison?.oneCheapAttempt?.gate ?? xh?.steps?.[1]?.gate} | ${xhGate ? (xhGate.ttyExit === 0 ? 'pass' : `FAIL exit ${xhGate.ttyExit}`) : 'not run'} | ${xh?.comparison?.oneCheapAttempt?.linesAdded ?? 'n/a'} | \`~/scratch/t1-pong-xhigh-out\` |`);
for (const [label, file] of [['HydraFusion build run 1 (round 2)', 'greenfield/pong3-hydrafusion-build/fusion-report.json'], ['HydraFusion build run 4 (round 2)', 'greenfield/pong5-hydrafusion-two-turn/fusion-report.json']]) {
  const r = readJson(raw(file)); if (r) say(`| ${label} | ${f2(r.phases?.[0]?.credits + (r.phases?.[1]?.credits ?? 0))} | pass | | | \`${file}\` |`);
}

// T2: cache lifetime.
say('\n## T2 cache lifetime: identical follow-up turn after a gap, same session\n');
say('Turn 1 reads 400 unique lines behind a unique nonce, so only the ~5k-token system prefix can be shared with other sessions. Turn 2 is "repeat your answer, no tools".\n');
say('| Model | Gap | Turn-2 input | cacheRead | cacheWrite | Turn-2 credits | Verdict | cacheExpiresAt claimed by CLI after turn 1 |');
say('| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
const cache = readJson(raw('probe-cache-lifetime/report.json'));
for (const s of (cache?.sessions ?? []).sort((a, b) => a.turns[0].model.localeCompare(b.turns[0].model) || a.turns[1].gapSec - b.turns[1].gapSec)) {
  const t1 = s.turns[0], t2 = s.turns[1]; const m = t2.model; const d = t2.delta[m] ?? {};
  const frac = d.input ? d.cacheRead / d.input : 0;
  const verdict = frac > 0.85 ? 'hit' : frac < 0.15 ? 'MISS' : `partial (${Math.round(frac * 100)}% read)`;
  say(`| ${m} | ${Math.round(t2.gapSec / 60)} min | ${d.input} | ${d.cacheRead} | ${d.cacheWrite} | ${f2(t2.credits)} | ${verdict} | ${t1.delta[m]?.cacheExpiresAt ?? ''} (sent ${t1.sentAt}) |`);
}
if (!cache) say('| not finished | | | | | | | |');

// T3: shunt total credits per task.
say('\n## T3 Shunt total credits per task (Sol main, from `sol-3-arms.json`, round 1 data)\n');
say('| Task | Baseline | Shunt | Delta | Delegated | Main calls base→shunt | Main input base→shunt |');
say('| --- | ---: | ---: | ---: | --- | --- | --- |');
const arms = readJson(raw('sol-3-arms.json'))?.results ?? [];
for (const name of [...new Set(arms.map(r => r.scenario))]) {
  const b = arms.find(r => r.scenario === name && r.arm === 'baseline'), s = arms.find(r => r.scenario === name && r.arm === 'shunt');
  if (!b || !s) continue;
  const bc = b.total.nanoAiu / 1e9, sc = s.total.nanoAiu / 1e9;
  say(`| ${name} | ${f2(bc)} | ${f2(sc)} | ${sc >= bc ? '+' : ''}${Math.round((sc / bc - 1) * 100)}% | ${s.delegations ? 'yes' : 'no'} | ${b.main.modelCalls}→${s.main.modelCalls} | ${b.main.input}→${s.main.input} |`);
}

// T4: model switch.
say('\n## T4 mid-session model switch (hard = cross-file-question, easy = find-a-value, then mid-size-file)\n');
say('| Session | Turn | Model | Requests | Input | cacheRead | cacheWrite | Output | Credits | Correct |');
say('| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
const sw = readJson(raw('probe-model-switch/report-recovered.json'));
for (const s of sw?.sessions ?? []) for (const t of s.turns) {
  const d = t.delta[t.model] ?? {};
  say(`| ${s.name} | ${t.turn} | ${t.model} | ${d.requests} | ${d.input} | ${d.cacheRead} | ${d.cacheWrite} | ${d.output} | ${f2(t.credits)} | ${t.correct ?? ''} |`);
}
const by = Object.fromEntries((sw?.sessions ?? []).map(s => [s.name, s]));
const after = (s, from) => s ? s.turns.slice(from).reduce((a, t) => a + t.credits, 0) : null;
say(`\nEasy turns after the hard Sol turn: stay on Sol ${f2(after(by['stay-sol'], 1))} | switch to Luna ${f2(after(by['switch-to-luna'], 1))} | same two turns in a fresh Luna session ${f2(after(by['fresh-luna'], 0))} | fresh Sol find-a-value alone ${f2(after(by['fresh-sol'], 0))}`);

// T5: HydraFusion minimal prompt.
say('\n## T5 HydraFusion: minimal prompt vs original one-liner (build only, one turn)\n');
say('| Prompt | Run | Route | Credits | Luna requests | Gate | tty-smoke | Python lines | Record |');
say('| --- | ---: | --- | ---: | ---: | --- | --- | ---: | --- |');
for (const [label, file] of [['original one-liner', 'greenfield/pong3-hydrafusion-build/fusion-report.json'], ['original one-liner (2-turn run, build turn)', 'greenfield/pong5-hydrafusion-two-turn/fusion-report.json']]) {
  const r = readJson(raw(file)); if (!r) continue;
  const draft = r.phases?.find(p => p.kind === 'draft');
  say(`| ${label} | | ${r.turns?.[0]?.pattern} ${r.turns?.[0]?.primaryModel}+${r.turns?.[0]?.secondaryModel} | ${f2(draft ? draft.credits + (r.phases.find(p => p.kind === 'critic')?.credits ?? 0) : r.credits)} | ${draft?.requests} | pass | | | \`${file}\` |`);
}
say('| original one-liner, runs 2–3 (round 2, folders not kept) | | critique | 1.25 / 25.30 | | | | | HANDOFF-2 |');
for (const i of [1, 2, 3]) {
  const r = readJson(raw(`greenfield/t5-fusion-minimal-${i}/fusion-report.json`)), g = readJson(raw(`greenfield/t5-fusion-minimal-${i}/gate.json`));
  if (!r) continue;
  say(`| **minimal (new)** | ${i} | ${r.turns?.[0]?.pattern} ${r.turns?.[0]?.primaryModel}+${r.turns?.[0]?.secondaryModel} | ${f2(r.credits)} | ${r.phases?.find(p => p.kind === 'draft')?.requests} | ${g ? (g.testsExit === 0 ? 'pass' : 'FAIL') : ''} | ${g ? (g.ttyExit === 0 ? 'pass' : 'FAIL') : ''} | ${g?.pyLines ?? ''} | \`greenfield/t5-fusion-minimal-${i}\` |`);
}

const cli = spawnSync('copilot', ['--version'], { encoding: 'utf8' }).stdout?.split('\n')[0] ?? '';
say(`\nCLI: ${cli}. Generated ${new Date().toISOString()} by experiments/summarise-round3.mjs.`);
const text = lines.join('\n');
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${text}\n`);
console.log(text);
