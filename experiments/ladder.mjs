#!/usr/bin/env node
// ladder: run a task on a cheap model twice, and pay for the strong model only where the two attempts disagree.
//
//   node experiments/ladder.mjs --repo /path/to/repo --task "..." --gate "npm test"
//
// Nothing here needs an answer key. The two attempts work in throwaway clones of the repository's committed
// state; your checkout is never touched. The repository's own check command is the gate. The attempts are
// compared file by file, and only disputed files are shown to the strong model. The result is a patch file
// plus a report; applying it is a separate, explicit step.
//
// Measured background and limits: docs/COST-EXPERIMENTS-RESULTS.md, follow-ups 3 and 4. In short: the work-method
// prompt is what makes the two attempts' mistakes independent enough for comparison to catch them, so it is on
// by default, and the ladder without it is not worth running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { arbitrationPrompt, bucketCredits, changedFiles, disputedFiles } from '../shunt-copilot/scripts/benchmark.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const VALUE_OPTIONS = ['--repo', '--task', '--task-file', '--gate', '--setup', '--cheap-model', '--strong-model', '--tools', '--out',
  '--timeout-sec', '--gate-timeout-sec', '--max-disputed', '--checklist-file'];
const FLAGS = ['--no-checklist', '--no-fallback', '--dry-run', '--no-custom-instructions', '--help'];

export function parseCli(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (FLAGS.includes(name)) options[name] = true;
    else if (VALUE_OPTIONS.includes(name)) {
      if (argv[i + 1] === undefined) throw new Error(`${name} needs a value.`);
      options[name] = argv[++i];
    } else throw new Error(`Unknown option: ${name}`);
  }
  return options;
}

const USAGE = `Usage: node experiments/ladder.mjs --repo <git repo> (--task "<text>" | --task-file <file>) [options]

  --gate "<command>"        The repository's own check (tests, build, lint). Run in each clone. Strongly recommended.
  --setup "<command>"       Run once in each clone before the attempts, for example "npm ci".
  --cheap-model <id>        Default gpt-5.6-luna.
  --strong-model <id>       Default gpt-5.6-sol.
  --tools <a,b,c> | all     Default view,rg,glob,bash,apply_patch. "all" lifts the restriction (needed for MCP tools).
  --max-disputed <n>        Above this many disputed files the cheap attempts are treated as failed (default 12).
  --no-fallback             Do not run the strong model from scratch when --max-disputed is exceeded; stop instead.
  --no-checklist            Drop the work-method prompt. Measured to make the ladder unreliable; for experiments only.
  --checklist-file <file>   Use your own work-method prompt instead of experiments/prompts/checklist.md.
  --no-custom-instructions  Ignore the repository's AGENTS.md / copilot-instructions.md.
  --out <dir>               Where clones, transcripts, the patch and the report go (default: a new temp directory).
  --timeout-sec <n>         Per model session (default 2400).   --gate-timeout-sec <n>  Per gate run (default 900).
  --dry-run                 Print the plan and exit without cloning or calling a model.

Only committed state is cloned. Uncommitted changes in --repo are not seen by the attempts.
The --gate and --setup strings are run with "sh -c" inside the clones; they are yours, so treat them like any script you run.`;

const sh = (command, cwd, timeoutMs) => spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const credits = usage => (usage?.totalNanoAiu ?? 0) / 1e9;

function session({ bin, dir, prompt, model, tools, customInstructions, out, tag, timeoutMs }) {
  const usageFile = path.join(out, `usage-${tag}.json`), transcript = path.join(out, `transcript-${tag}.jsonl`);
  const args = ['-C', dir, '-p', prompt, `--session-id=${randomUUID()}`, '--allow-all-tools', '--no-ask-user', '--disable-builtin-mcps',
    ...(customInstructions ? [] : ['--no-custom-instructions']), '--output-format', 'json', '--stream', 'off', '--log-level', 'none',
    '--usage-output-file', usageFile, '--model', model, ...(tools ? ['--available-tools', ...tools] : [])];
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd: dir, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.pipe(fs.createWriteStream(transcript));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const done = exitCode => { clearTimeout(timer); resolve({ exitCode, seconds: Math.round((Date.now() - started) / 1000), usage: readJson(usageFile), answer: finalAnswer(transcript) }); };
    child.on('error', () => done(-1));
    child.on('close', done);
  });
}

function finalAnswer(transcript) {
  try {
    const events = fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    return events.findLast(e => e.type === 'assistant.message' && e.data?.phase === 'final_answer')?.data?.content ?? '';
  } catch { return ''; }
}

function clone(repo, dest, setup, gateTimeoutMs) {
  const made = spawnSync('git', ['clone', '--quiet', '--local', repo, dest], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`Could not clone ${repo}: ${made.stderr.trim()}`);
  if (setup) {
    const ran = sh(setup, dest, gateTimeoutMs);
    if (ran.status !== 0) throw new Error(`--setup failed in ${dest}:\n${(ran.stdout + ran.stderr).slice(-2000)}`);
    // Whatever setup produced (node_modules and the like) is not the attempt's work.
    git(dest, 'add', '-A');
    git(dest, '-c', 'user.name=ladder', '-c', 'user.email=ladder@example.invalid', 'commit', '-qm', 'ladder: setup output', '--allow-empty');
  }
  return dest;
}

function runGate(gate, dir, timeoutMs, log) {
  if (!gate) return { passed: true, skipped: true };
  const ran = sh(gate, dir, timeoutMs);
  fs.writeFileSync(log, `${ran.stdout ?? ''}${ran.stderr ?? ''}`);
  return { passed: ran.status === 0, skipped: false, log };
}

function copyVersion(file, fromProject, toRoot) {
  const from = path.join(fromProject, file), to = path.join(toRoot, file);
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

export async function ladder(options) {
  const { repo, task, gate, setup, cheap, strong, tools, customInstructions, checklist, maxDisputed, fallback, out, bin, timeoutMs, gateTimeoutMs, log = console.log } = options;
  const prompt = checklist ? `${checklist}\n\n${task}` : task;
  const report = { repo, task, cheapModel: cheap, strongModel: strong, gate: gate ?? null, startedAt: new Date().toISOString(), steps: [], credits: {} };
  const step = (name, detail) => { report.steps.push({ name, ...detail }); log(`- ${name}: ${Object.entries(detail).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : v}`).join(' ')}`); };
  const common = { bin, tools, customInstructions, out, timeoutMs };

  const a = clone(repo, path.join(out, 'attempt-a'), setup, gateTimeoutMs), b = clone(repo, path.join(out, 'attempt-b'), setup, gateTimeoutMs);
  const before = runGate(gate, a, gateTimeoutMs, path.join(out, 'gate-before.log'));
  git(a, 'checkout', '-q', '--', '.');
  step('gate before any change', { passed: before.passed, skipped: before.skipped });

  const [first, second] = await Promise.all([
    session({ ...common, dir: a, prompt, model: cheap, tag: 'attempt-a' }),
    session({ ...common, dir: b, prompt, model: cheap, tag: 'attempt-b' }),
  ]);
  report.credits.attemptA = credits(first.usage); report.credits.attemptB = credits(second.usage);
  const gateA = first.exitCode === 0 && runGate(gate, a, gateTimeoutMs, path.join(out, 'gate-a.log')).passed;
  const gateB = second.exitCode === 0 && runGate(gate, b, gateTimeoutMs, path.join(out, 'gate-b.log')).passed;
  step('two cheap attempts', { creditsA: report.credits.attemptA.toFixed(2), creditsB: report.credits.attemptB.toFixed(2), gateA, gateB,
    changedA: changedFiles(a).length, changedB: changedFiles(b).length });

  // Work from an attempt that passes the gate. `base` is what the patch is taken from; `other` is the second opinion.
  const [base, other] = !gateA && gateB ? [b, a] : [a, b];
  const disputed = disputedFiles(base, other);
  step('comparison', { disputed, agreedFiles: changedFiles(base).length - disputed.filter(f => changedFiles(base).includes(f)).length });
  report.disputed = disputed;

  let verdict, finalDir = base;
  if (!disputed.length && (gateA || gateB)) verdict = 'ACCEPTED: both attempts agree and the gate passes';
  else if (disputed.length > maxDisputed || (!gateA && !gateB && !disputed.length)) {
    if (!fallback) verdict = `STOPPED: ${disputed.length} disputed files exceeds --max-disputed ${maxDisputed}; the cheap attempts did not converge`;
    else {
      const c = clone(repo, path.join(out, 'strong-solo'), setup, gateTimeoutMs);
      const solo = await session({ ...common, dir: c, prompt, model: strong, tag: 'strong-solo' });
      report.credits.strongSolo = credits(solo.usage);
      const gateC = solo.exitCode === 0 && runGate(gate, c, gateTimeoutMs, path.join(out, 'gate-strong-solo.log')).passed;
      step('strong model from scratch', { credits: report.credits.strongSolo.toFixed(2), gate: gateC });
      finalDir = c;
      verdict = gateC ? 'STRONG MODEL: the cheap attempts did not converge, the strong model did the task and the gate passes'
        : 'NEEDS HUMAN: the cheap attempts did not converge and the strong model\'s result fails the gate';
    }
  } else {
    const otherDir = '.ladder-other';
    const shown = disputed.length ? disputed : changedFiles(base);
    for (const file of shown) copyVersion(file, other, path.join(base, otherDir));
    const arbitration = await session({ ...common, dir: base, prompt: arbitrationPrompt([task], shown, otherDir), model: strong, tag: 'arbitration' });
    fs.rmSync(path.join(base, otherDir), { recursive: true, force: true });
    report.credits.arbitration = credits(arbitration.usage);
    report.arbitrationAnswer = arbitration.answer;
    const after = arbitration.exitCode === 0 && runGate(gate, base, gateTimeoutMs, path.join(out, 'gate-after-arbitration.log')).passed;
    step('strong model on disputed files only', { files: shown, credits: report.credits.arbitration.toFixed(2), gate: after });
    verdict = after ? `ARBITRATED: the strong model settled ${shown.length} disputed file(s) and the gate passes`
      : 'NEEDS HUMAN: the gate fails after arbitration';
  }

  git(finalDir, 'add', '-A');
  const patch = git(finalDir, 'diff', '--cached', '--binary', 'HEAD').stdout;
  const patchFile = path.join(out, 'result.patch');
  fs.writeFileSync(patchFile, patch);
  report.verdict = verdict;
  report.patch = patchFile;
  report.credits.total = Object.values(report.credits).reduce((sum, value) => sum + value, 0);
  report.buckets = ['attempt-a', 'attempt-b', 'arbitration', 'strong-solo'].map(tag => readJson(path.join(out, `usage-${tag}.json`))).filter(Boolean).map(bucketCredits);
  report.answers = { attemptA: first.answer, attemptB: second.answer };
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (cli['--help'] || !process.argv.slice(2).length) { console.log(USAGE); return; }
  if (!cli['--repo']) throw new Error('--repo is required.');
  const repo = path.resolve(cli['--repo']);
  if (!fs.existsSync(path.join(repo, '.git'))) throw new Error('--repo must be the root of a git repository.');
  if (Boolean(cli['--task']) === Boolean(cli['--task-file'])) throw new Error('Give exactly one of --task and --task-file.');
  const task = (cli['--task'] ?? fs.readFileSync(cli['--task-file'], 'utf8')).trim();
  if (!task) throw new Error('The task is empty.');
  const toolsArg = cli['--tools'] ?? 'view,rg,glob,bash,apply_patch';
  const tools = toolsArg === 'all' ? null : toolsArg.split(',').map(t => t.trim()).filter(Boolean);
  if (tools?.some(t => !/^[A-Za-z0-9_.:-]+$/.test(t))) throw new Error('--tools takes plain tool identifiers, or "all".');
  const number = (name, fallback) => { const value = Number(cli[name] ?? fallback); if (!(value > 0)) throw new Error(`${name} must be a positive number.`); return value; };
  const checklistFile = cli['--checklist-file'] ?? path.join(here, 'prompts/checklist.md');
  const options = {
    repo, task, gate: cli['--gate'], setup: cli['--setup'], cheap: cli['--cheap-model'] ?? 'gpt-5.6-luna', strong: cli['--strong-model'] ?? 'gpt-5.6-sol',
    tools, customInstructions: !cli['--no-custom-instructions'], checklist: cli['--no-checklist'] ? null : fs.readFileSync(checklistFile, 'utf8').trim(),
    maxDisputed: number('--max-disputed', 12), fallback: !cli['--no-fallback'], bin: process.env.LADDER_COPILOT_BIN || 'copilot',
    timeoutMs: number('--timeout-sec', 2400) * 1000, gateTimeoutMs: number('--gate-timeout-sec', 900) * 1000,
  };
  const dirty = git(repo, 'status', '--porcelain').stdout.trim();
  console.log(`Repository: ${repo} @ ${git(repo, 'rev-parse', '--short', 'HEAD').stdout.trim()}`);
  if (dirty) console.log('WARNING: the repository has uncommitted changes. Only committed state is cloned; the attempts will not see them.');
  if (!options.gate) console.log('WARNING: no --gate. Agreement between two attempts is then the only check, and two attempts can agree on a mistake.');
  if (!options.checklist) console.log('WARNING: --no-checklist. Measured 3/5 accepted without it against 3/3 with it.');
  console.log(`Cheap: ${options.cheap} x2 | strong: ${options.strong} on disputed files only | tools: ${tools ? tools.join(',') : 'all'} | gate: ${options.gate ?? '(none)'}`);
  if (cli['--dry-run']) { console.log('Dry run: nothing was cloned or sent.'); return; }
  options.out = path.resolve(cli['--out'] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-')));
  fs.mkdirSync(options.out, { recursive: true });
  if (fs.readdirSync(options.out).length) throw new Error(`${options.out} is not empty. Results are never overwritten; choose a new --out.`);
  const report = await ladder(options);
  console.log(`\n${report.verdict}`);
  console.log(`Credits: ${Object.entries(report.credits).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' | ')}  (1 credit = $0.01)`);
  console.log(`Patch:   ${report.patch}${fs.statSync(report.patch).size ? '' : '  (empty: no change was made)'}`);
  console.log(`Report:  ${path.join(options.out, 'report.json')}`);
  if (fs.statSync(report.patch).size) console.log(`\nReview it, then apply with:\n  git -C ${repo} apply --index ${report.patch}`);
  if (!/^(ACCEPTED|ARBITRATED|STRONG MODEL)/.test(report.verdict)) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error(`[ladder] ${error.message}`); process.exit(1); }
}
