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
  '--timeout-sec', '--gate-timeout-sec', '--max-disputed', '--checklist-file', '--spec-model', '--spec-prompt-file', '--cheap-attempts', '--cheap-effort'];
const FLAGS = ['--no-checklist', '--no-fallback', '--compare-strong', '--dry-run', '--no-custom-instructions', '--help'];

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
  --spec-model <id>         First let this model turn the task into SPEC.md plus acceptance tests, without implementing it. The
                            cheap attempts then implement against those files and may not change them: they are restored
                            before every gate run. The patch contains the specification, the tests and the implementation.
  --spec-prompt-file <file> Use your own instructions for the specification author instead of experiments/prompts/spec-writer.md.
  --cheap-attempts <1|2>    Default 2. With 1 there is nothing to compare: the gate alone decides, and a red gate falls back.
  --cheap-effort <level>    Reasoning effort for the cheap attempts only (none, minimal, low, medium, high, xhigh, max). Default: the CLI's.
  --compare-strong          Also run the strong model alone on the same task, in its own clone, and report both side by side.
                            Costs a full strong-model run; the ladder's own decisions never see its result.
  --no-checklist            Drop the work-method prompt. Measured to make the ladder unreliable; for experiments only.
  --checklist-file <file>   Use your own work-method prompt instead of experiments/prompts/checklist.md.
  --no-custom-instructions  Ignore the repository's AGENTS.md / copilot-instructions.md.
  --out <dir>               Where clones, transcripts, the patch and the report go (default: a new temp directory).
  --timeout-sec <n>         Per model session (default 2400).   --gate-timeout-sec <n>  Per gate run (default 900).
  --dry-run                 Print the plan and exit without cloning or calling a model.

Only committed state is cloned. Uncommitted changes in --repo are not seen by the attempts.
A repository with no commits yet works too, and a --repo that is missing or an empty directory is initialised with "git init".
The --gate and --setup strings are run with "sh -c" inside the clones; they are yours, so treat them like any script you run.`;

const sh = (command, cwd, timeoutMs) => spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const credits = usage => (usage?.totalNanoAiu ?? 0) / 1e9;

// The copilot launcher execs a child binary; killing only the launcher leaves that child alive holding our stdout pipe,
// so 'close' never fires and a stalled session hangs the whole run. Kill the process group, then drop the pipe.
function killTree(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  child.stdout?.destroy();
}
function session({ bin, dir, prompt, model, tools, customInstructions, out, tag, timeoutMs, effort }) {
  const usageFile = path.join(out, `usage-${tag}.json`), transcript = path.join(out, `transcript-${tag}.jsonl`);
  const args = ['-C', dir, '-p', prompt, `--session-id=${randomUUID()}`, '--allow-all-tools', '--no-ask-user', '--disable-builtin-mcps',
    ...(customInstructions ? [] : ['--no-custom-instructions']), '--output-format', 'json', '--stream', 'off', '--log-level', 'none',
    '--usage-output-file', usageFile, '--model', model, ...(effort ? ['--reasoning-effort', effort] : []), ...(tools ? ['--available-tools', ...tools] : [])];
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd: dir, shell: false, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.pipe(fs.createWriteStream(transcript));
    const timer = setTimeout(() => killTree(child), timeoutMs);
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
  // Interpreter caches appear when an attempt or the gate runs the code. They differ between any two runs, so without
  // this they are all "disputed", the strong model is paid to settle them, and they end up in the patch.
  fs.appendFileSync(path.join(dest, '.git/info/exclude'), '\n__pycache__/\n*.pyc\n.pytest_cache/\n.mypy_cache/\n.ruff_cache/\n');
  // A repository with no commits has no HEAD to diff against, so every clone of one starts from an empty commit.
  if (git(dest, 'rev-parse', '--verify', '-q', 'HEAD').status !== 0) {
    git(dest, '-c', 'user.name=ladder', '-c', 'user.email=ladder@example.invalid', 'commit', '-qm', 'ladder: empty start', '--allow-empty');
  }
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

// Size of what a clone holds beyond its starting commit. Stages everything, which the final patch does anyway.
function changeSize(dir, since = 'HEAD') {
  git(dir, 'add', '-A');
  const rows = git(dir, 'diff', '--cached', '--numstat', since).stdout.split('\n').filter(Boolean);
  return { files: rows.length, linesAdded: rows.reduce((sum, row) => sum + (Number(row.split('\t')[0]) || 0), 0) };
}

export async function ladder(options) {
  const { repo, task, gate, setup, cheap, strong, tools, customInstructions, checklist, maxDisputed, fallback, compareStrong = false, specModel = null, specPrompt = null, attempts = 2, out, bin, timeoutMs, gateTimeoutMs, log = console.log } = options;
  const prompt = checklist ? `${checklist}\n\n${task}` : task;
  const report = { repo, task, cheapModel: cheap, strongModel: strong, gate: gate ?? null, startedAt: new Date().toISOString(), steps: [], credits: {} };
  const step = (name, detail) => { report.steps.push({ name, ...detail }); log(`- ${name}: ${Object.entries(detail).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : v}`).join(' ')}`); };
  const common = { bin, tools, customInstructions, out, timeoutMs };

  // With --spec-model the attempts start from a clone that already holds the specification and its acceptance tests.
  // `since` is the commit the user's repository is at, so the patch carries those files as well as the implementation.
  let source = repo, since = 'HEAD', specFiles = [], implementPrompt = prompt;
  if (specModel) {
    source = clone(repo, path.join(out, 'spec'), setup, gateTimeoutMs);
    since = git(source, 'rev-parse', 'HEAD').stdout.trim();
    const wrote = await session({ ...common, dir: source, model: specModel, tag: 'spec',
      prompt: `${specPrompt}\n\nThe acceptance command will be: ${gate ?? '(none given; choose one and state it in SPEC.md)'}\n\nThe request:\n${task}` });
    report.credits.spec = credits(wrote.usage);
    report.specAnswer = wrote.answer;
    specFiles = changedFiles(source);
    step('specification and acceptance tests', { model: specModel, credits: report.credits.spec.toFixed(2), seconds: wrote.seconds, files: specFiles });
    if (wrote.exitCode !== 0 || !specFiles.length) throw new Error(`The specification author wrote nothing (exit ${wrote.exitCode}). See ${path.join(out, 'transcript-spec.jsonl')}.`);
    git(source, 'add', '-A');
    git(source, '-c', 'user.name=ladder', '-c', 'user.email=ladder@example.invalid', 'commit', '-qm', 'ladder: specification and acceptance tests');
    report.specFiles = specFiles;
    implementPrompt = `${checklist ? `${checklist}\n\n` : ''}Implement SPEC.md in this repository. It is the full statement of the request below, and every numbered requirement in it is binding.\n`
      + `These files are the acceptance check and are not yours to change; any edit to them is discarded before the check runs:\n${specFiles.map(f => `- ${f}`).join('\n')}\n`
      + `If one of them contradicts SPEC.md, implement SPEC.md and say so in your final answer.\n\nThe request was:\n${task}`;
  }
  const specCommit = specModel ? git(source, 'rev-parse', 'HEAD').stdout.trim() : null;
  // Puts the specification author's files back, so an attempt cannot pass the gate by weakening it.
  const protect = dir => {
    if (!specCommit) return [];
    const tampered = git(dir, 'diff', '--name-only', specCommit, '--', ...specFiles).stdout.split('\n').filter(Boolean);
    git(dir, 'checkout', '-q', specCommit, '--', ...specFiles);
    return tampered;
  };
  const single = attempts === 1;

  const a = clone(source, path.join(out, 'attempt-a'), setup, gateTimeoutMs), b = single ? null : clone(source, path.join(out, 'attempt-b'), setup, gateTimeoutMs);
  const before = runGate(gate, a, gateTimeoutMs, path.join(out, 'gate-before.log'));
  git(a, 'checkout', '-q', '--', '.');
  step('gate before any change', { passed: before.passed, skipped: before.skipped });

  // The strong model from scratch, in a third clone. It is the fallback, and with --compare-strong also the yardstick;
  // it runs at most once, so a comparison run that falls back does not pay for it twice.
  const strongSolo = async () => {
    const dir = clone(repo, path.join(out, 'strong-solo'), setup, gateTimeoutMs);
    const run = await session({ ...common, dir, prompt, model: strong, tag: 'strong-solo' });
    return { dir, run, gate: run.exitCode === 0 && runGate(gate, dir, gateTimeoutMs, path.join(out, 'gate-strong-solo.log')).passed };
  };
  const yardstick = compareStrong ? strongSolo() : null;

  const [first, second] = await Promise.all([
    session({ ...common, dir: a, prompt: implementPrompt, model: cheap, tag: 'attempt-a', effort: options.cheapEffort }),
    single ? { exitCode: 1, seconds: 0, usage: null, answer: '' } : session({ ...common, dir: b, prompt: implementPrompt, model: cheap, tag: 'attempt-b', effort: options.cheapEffort }),
  ]);
  report.credits.attemptA = credits(first.usage);
  if (!single) report.credits.attemptB = credits(second.usage);
  const tampered = [...new Set([...protect(a), ...(single ? [] : protect(b))])];
  if (specModel) report.tamperedSpecFiles = tampered;
  const gateA = first.exitCode === 0 && runGate(gate, a, gateTimeoutMs, path.join(out, 'gate-a.log')).passed;
  const gateB = !single && second.exitCode === 0 && runGate(gate, b, gateTimeoutMs, path.join(out, 'gate-b.log')).passed;
  if (single) step('one cheap attempt', { credits: report.credits.attemptA.toFixed(2), gate: gateA, changed: changedFiles(a).length, ...(specModel ? { restoredSpecFiles: tampered } : {}) });
  else step('two cheap attempts', { creditsA: report.credits.attemptA.toFixed(2), creditsB: report.credits.attemptB.toFixed(2), gateA, gateB,
    changedA: changedFiles(a).length, changedB: changedFiles(b).length, ...(specModel ? { restoredSpecFiles: tampered } : {}) });

  // Work from an attempt that passes the gate. `base` is what the patch is taken from; `other` is the second opinion.
  const [base, other] = !gateA && gateB ? [b, a] : [a, b];
  const disputed = single ? [] : disputedFiles(base, other);
  if (!single) step('comparison', { disputed, agreedFiles: changedFiles(base).length - disputed.filter(f => changedFiles(base).includes(f)).length });
  report.disputed = disputed;

  // Taken before arbitration edits `base`, so this row is what one cheap attempt alone would have delivered.
  const oneCheap = compareStrong ? { credits: credits((base === a ? first : second).usage), gate: base === a ? gateA : gateB,
    seconds: (base === a ? first : second).seconds, ...changeSize(base, since) } : null;

  let verdict, finalDir = base, laterSeconds = 0;
  if (!disputed.length && (gateA || gateB)) verdict = single ? 'ACCEPTED: the single attempt passes the gate; nothing else checked it' : 'ACCEPTED: both attempts agree and the gate passes';
  else if (disputed.length > maxDisputed || (!gateA && !gateB && !disputed.length)) {
    if (!fallback) verdict = single ? 'STOPPED: the single attempt fails the gate' : `STOPPED: ${disputed.length} disputed files exceeds --max-disputed ${maxDisputed}; the cheap attempts did not converge`;
    else {
      const { dir: c, run: solo, gate: gateC } = await (yardstick ?? strongSolo());
      report.credits.strongSolo = credits(solo.usage);
      laterSeconds = solo.seconds;
      step('strong model from scratch', { credits: report.credits.strongSolo.toFixed(2), gate: gateC });
      finalDir = c;
      since = 'HEAD';
      verdict = gateC ? 'STRONG MODEL: the cheap attempts did not converge, the strong model did the task and the gate passes'
        : 'NEEDS HUMAN: the cheap attempts did not converge and the strong model\'s result fails the gate';
    }
  } else {
    const otherDir = '.ladder-other';
    const shown = disputed.length ? disputed : changedFiles(base);
    // Arbitrate in a copy, so both cheap attempts stay on disk exactly as the cheap model left them.
    finalDir = path.join(out, 'ladder-final');
    fs.cpSync(base, finalDir, { recursive: true });
    for (const file of shown) copyVersion(file, other, path.join(finalDir, otherDir));
    const arbitration = await session({ ...common, dir: finalDir, prompt: arbitrationPrompt([task], shown, otherDir), model: strong, tag: 'arbitration' });
    fs.rmSync(path.join(finalDir, otherDir), { recursive: true, force: true });
    report.credits.arbitration = credits(arbitration.usage);
    report.arbitrationAnswer = arbitration.answer;
    laterSeconds = arbitration.seconds;
    protect(finalDir);
    const after = arbitration.exitCode === 0 && runGate(gate, finalDir, gateTimeoutMs, path.join(out, 'gate-after-arbitration.log')).passed;
    step('strong model on disputed files only', { files: shown, credits: report.credits.arbitration.toFixed(2), gate: after });
    verdict = after ? `ARBITRATED: the strong model settled ${shown.length} disputed file(s) and the gate passes`
      : 'NEEDS HUMAN: the gate fails after arbitration';
  }

  git(finalDir, 'add', '-A');
  const patch = git(finalDir, 'diff', '--cached', '--binary', since).stdout;
  const patchFile = path.join(out, 'result.patch');
  fs.writeFileSync(patchFile, patch);
  report.verdict = verdict;
  report.patch = patchFile;
  report.credits.total = Object.values(report.credits).reduce((sum, value) => sum + value, 0);
  if (yardstick) {
    // Kept out of report.credits: the yardstick is the price of measuring, not of the ladder.
    const { dir, run, gate: gateC } = await yardstick;
    const size = changeSize(dir);
    fs.writeFileSync(path.join(out, 'strong-solo.patch'), git(dir, 'diff', '--cached', '--binary', 'HEAD').stdout);
    report.comparison = {
      oneCheapAttempt: oneCheap,
      ladder: { credits: report.credits.total, gate: /^(ACCEPTED|ARBITRATED|STRONG MODEL)/.test(verdict), seconds: Math.max(first.seconds, second.seconds) + laterSeconds, ...changeSize(finalDir, since) },
      strongAlone: { credits: credits(run.usage), gate: gateC, seconds: run.seconds, ...size },
      strongAlonePatch: path.join(out, 'strong-solo.patch'), strongAloneAnswer: run.answer,
    };
  }
  report.buckets = ['spec', 'attempt-a', 'attempt-b', 'arbitration', 'strong-solo'].map(tag => readJson(path.join(out, `usage-${tag}.json`))).filter(Boolean).map(bucketCredits);
  report.answers = { attemptA: first.answer, attemptB: second.answer };
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (cli['--help'] || !process.argv.slice(2).length) { console.log(USAGE); return; }
  if (!cli['--repo']) throw new Error('--repo is required.');
  const repo = path.resolve(cli['--repo']);
  const fresh = !fs.existsSync(repo) || (fs.statSync(repo).isDirectory() && !fs.readdirSync(repo).length);
  if (fresh && !cli['--dry-run']) {
    fs.mkdirSync(repo, { recursive: true });
    if (spawnSync('git', ['init', '-q', repo]).status !== 0) throw new Error(`Could not "git init" ${repo}.`);
    console.log(`Initialised an empty git repository in ${repo}.`);
  } else if (!fresh && !fs.existsSync(path.join(repo, '.git'))) throw new Error('--repo must be the root of a git repository, or an empty or missing directory to start one in.');
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
    maxDisputed: number('--max-disputed', 12), fallback: !cli['--no-fallback'], compareStrong: Boolean(cli['--compare-strong']),
    specModel: cli['--spec-model'] ?? null, specPrompt: fs.readFileSync(cli['--spec-prompt-file'] ?? path.join(here, 'prompts/spec-writer.md'), 'utf8').trim(),
    attempts: Number(cli['--cheap-attempts'] ?? 2), cheapEffort: cli['--cheap-effort'] ?? null, bin: process.env.LADDER_COPILOT_BIN || 'copilot',
    timeoutMs: number('--timeout-sec', 2400) * 1000, gateTimeoutMs: number('--gate-timeout-sec', 900) * 1000,
  };
  if (![1, 2].includes(options.attempts)) throw new Error('--cheap-attempts is 1 or 2.');
  if (options.cheapEffort && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(options.cheapEffort)) throw new Error(`Unknown --cheap-effort: ${options.cheapEffort}`);
  const dirty = fresh ? '' : git(repo, 'status', '--porcelain').stdout.trim();
  console.log(`Repository: ${repo} @ ${(!fresh && git(repo, 'rev-parse', '--short', '-q', '--verify', 'HEAD').stdout.trim()) || '(no commits yet)'}`);
  if (dirty) console.log('WARNING: the repository has uncommitted changes. Only committed state is cloned; the attempts will not see them.');
  if (!options.gate) console.log('WARNING: no --gate. Agreement between two attempts is then the only check, and two attempts can agree on a mistake.');
  if (!options.checklist) console.log('WARNING: --no-checklist. Measured 3/5 accepted without it against 3/3 with it.');
  if (options.specModel) console.log(`Specification: ${options.specModel} writes SPEC.md and the acceptance tests first; the attempts cannot change them.`);
  console.log(`Cheap: ${options.cheap} x${options.attempts} | strong: ${options.strong} on disputed files only | tools: ${tools ? tools.join(',') : 'all'} | gate: ${options.gate ?? '(none)'}`);
  if (options.compareStrong) console.log(`Comparison: ${options.strong} also does the whole task alone, in its own clone.`);
  if (cli['--dry-run']) { console.log('Dry run: nothing was cloned or sent.'); return; }
  options.out = path.resolve(cli['--out'] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-')));
  fs.mkdirSync(options.out, { recursive: true });
  if (fs.readdirSync(options.out).length) throw new Error(`${options.out} is not empty. Results are never overwritten; choose a new --out.`);
  const report = await ladder(options);
  console.log(`\n${report.verdict}`);
  console.log(`Credits: ${Object.entries(report.credits).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' | ')}  (1 credit = $0.01)`);
  if (report.comparison) {
    const row = (name, r) => `  ${name.padEnd(18)} ${r.credits.toFixed(2).padStart(8)}  ${(r.gate ? 'pass' : 'FAIL').padEnd(5)} ${String(r.files).padStart(5)} ${String(r.linesAdded).padStart(7)} ${String(r.seconds).padStart(8)}`;
    console.log(`\n  ${''.padEnd(18)} ${'credits'.padStart(8)}  gate  ${'files'.padStart(5)} ${'+lines'.padStart(7)} ${'seconds'.padStart(8)}`);
    console.log(row(`one ${options.cheap}`, report.comparison.oneCheapAttempt));
    console.log(row('ladder', report.comparison.ladder));
    console.log(row(`${options.strong} alone`, report.comparison.strongAlone));
    console.log(`Strong-alone patch: ${report.comparison.strongAlonePatch}`);
  }
  console.log(`Patch:   ${report.patch}${fs.statSync(report.patch).size ? '' : '  (empty: no change was made)'}`);
  console.log(`Report:  ${path.join(options.out, 'report.json')}`);
  if (fs.statSync(report.patch).size) console.log(`\nReview it, then apply with:\n  git -C ${repo} apply --index ${report.patch}`);
  if (!/^(ACCEPTED|ARBITRATED|STRONG MODEL)/.test(report.verdict)) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error(`[ladder] ${error.message}`); process.exit(1); }
}
