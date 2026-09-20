// Live A/B benchmark: the same prompt through Copilot CLI with and without this plugin.
// Every number comes from the CLI's own --usage-output-file, not from a characters/4 estimate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { config, mainError, parseArgs, pluginRoot } from './common.mjs';

const TOPICS = ['invoice', 'shipment', 'refund', 'subscription', 'coupon', 'address', 'warehouse', 'carrier',
  'parcel', 'label', 'customs', 'pickup', 'return', 'notification', 'webhook', 'audit', 'ledger', 'payout'];
const ACTIONS = ['Created', 'Updated', 'Cancelled', 'Archived', 'Validated', 'Escalated'];

function handler(topic, action, index) {
  const name = `handle${topic[0].toUpperCase()}${topic.slice(1)}${action}`;
  return `/** Applies the "${action.toLowerCase()}" transition to one ${topic} event. */
export function ${name}(event, store) {
  if (!event || typeof event.id !== 'string') throw new TypeError('${name}: event.id is required');
  const previous = store.get(event.id) ?? { id: event.id, topic: '${topic}', revision: 0, history: [] };
  const weight = (event.amount ?? 0) * ${index + 3} + previous.revision;
  const next = {
    ...previous,
    revision: previous.revision + 1,
    status: '${action.toLowerCase()}',
    weight,
    history: [...previous.history, { at: event.at ?? 0, status: '${action.toLowerCase()}', weight }],
  };
  store.set(event.id, next);
  return next;
}
`;
}

// Synthetic, deterministic project. Large enough that a whole-file read is the dominant cost of a question.
export function buildFixture(dest) {
  fs.mkdirSync(path.join(dest, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'tests'));
  const handlers = TOPICS.flatMap((topic, t) => ACTIONS.map((action, a) => handler(topic, action, t * ACTIONS.length + a)));
  const retry = `export const RETRY_LIMIT = 7;
export const BACKOFF_MS = 250;

/** Calls send(parcel) until it succeeds, waiting BACKOFF_MS between attempts, at most RETRY_LIMIT times. */
export async function retryDelivery(parcel, send, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try { return await send(parcel, attempt); }
    catch (error) { lastError = error; await sleep(BACKOFF_MS); }
  }
  throw new Error(\`delivery failed after \${RETRY_LIMIT} attempts: \${lastError?.message}\`);
}
`;
  handlers.splice(Math.floor(handlers.length / 2), 0, retry);
  fs.writeFileSync(path.join(dest, 'src/delivery-service.mjs'), `// Event handlers for the delivery pipeline.\n\n${handlers.join('\n')}`);

  fs.writeFileSync(path.join(dest, 'src/user-service.mjs'), `export class UserService {
  constructor() { this.users = new Map(); }

  createUser(id, name) {
    if (this.users.has(id)) throw new Error(\`user \${id} already exists\`);
    const user = { id, name, active: true };
    this.users.set(id, user);
    return user;
  }

  getUser(id) {
    const user = this.users.get(id);
    if (!user) throw new Error(\`user \${id} not found\`);
    return user;
  }

  deactivateUser(id) {
    const user = this.getUser(id);
    user.active = false;
    return user;
  }

  isActive(id) { return this.users.get(id)?.active === true; }
}
`);

  const orderPadding = TOPICS.map(topic => `  /** Totals the ${topic} lines of an order. */
  ${topic}Total(order) {
    return order.lines.filter(line => line.kind === '${topic}').reduce((sum, line) => sum + line.price * line.quantity, 0);
  }
`).join('\n');
  fs.writeFileSync(path.join(dest, 'src/order-service.mjs'), `import { retryDelivery } from './delivery-service.mjs';

export class OrderService {
  constructor(users, send) { this.users = users; this.send = send; this.orders = new Map(); }

  createOrder(id, userId, lines) {
    if (this.orders.has(id)) throw new Error(\`order \${id} already exists\`);
    const order = { id, userId, lines, shipped: false };
    this.orders.set(id, order);
    return order;
  }

  getOrder(id) {
    const order = this.orders.get(id);
    if (!order) throw new Error(\`order \${id} not found\`);
    return order;
  }

${orderPadding}
  /** Ships an order, but only for an active user. */
  async submitOrder(id) {
    const order = this.getOrder(id);
    if (!this.users.isActive(order.userId)) throw new Error('inactive user');
    await retryDelivery(order, this.send);
    order.shipped = true;
    return order;
  }
}
`);

  // Over the plugin's line threshold but small enough that Copilot CLI's own view tool still returns it whole.
  const tiers = ['bronze', 'silver', 'gold', 'platinum'];
  const rules = Array.from({ length: 120 }, (_, i) => `rule('SKU-${String(i + 1).padStart(3, '0')}', {
  tier: '${tiers[i % tiers.length]}',
  off: ${i === 76 ? 40 : (i * 7) % 23},
});
`).join('');
  fs.writeFileSync(path.join(dest, 'src/pricing-rules.mjs'), `export const rules = new Map();
const rule = (sku, value) => rules.set(sku, value);

${rules}
export const discountFor = sku => rules.get(sku)?.off ?? 0;
`);

  const referenceCases = TOPICS.map(topic => `test('${topic}Total sums only ${topic} lines', () => {
  const { orders } = setup();
  const order = orders.createOrder('o-${topic}', 'u1', [
    { kind: '${topic}', price: 4, quantity: 3 },
    { kind: 'other', price: 100, quantity: 1 },
  ]);
  assert.equal(orders.${topic}Total(order), 12);
});
`).join('\n');
  fs.writeFileSync(path.join(dest, 'tests/order-service.test.mjs'), `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrderService } from '../src/order-service.mjs';
import { UserService } from '../src/user-service.mjs';

function setup(send = async () => 'sent') {
  const users = new UserService();
  users.createUser('u1', 'Ada');
  return { users, orders: new OrderService(users, send) };
}

test('createOrder stores an unshipped order', () => {
  const { orders } = setup();
  assert.deepEqual(orders.createOrder('o1', 'u1', []), { id: 'o1', userId: 'u1', lines: [], shipped: false });
});

test('createOrder rejects a duplicate id', () => {
  const { orders } = setup();
  orders.createOrder('o1', 'u1', []);
  assert.throws(() => orders.createOrder('o1', 'u1', []), /already exists/);
});

test('getOrder rejects an unknown id', () => {
  const { orders } = setup();
  assert.throws(() => orders.getOrder('missing'), /not found/);
});

${referenceCases}
test('submitOrder ships for an active user', async () => {
  const { orders } = setup();
  orders.createOrder('o1', 'u1', []);
  assert.equal((await orders.submitOrder('o1')).shipped, true);
});

test('submitOrder refuses an inactive user', async () => {
  const { users, orders } = setup();
  orders.createOrder('o1', 'u1', []);
  users.deactivateUser('u1');
  await assert.rejects(orders.submitOrder('o1'), /inactive user/);
});
`);
  // A repository boundary keeps ancestor instructions and hooks out of both arms.
  spawnSync('git', ['init', '-q', dest]);
}

const ARMS = ['baseline', 'shunt', 'fleet', 'economy', 'cheap-first', 'review-loop', 'ladder'];

// E13: the cheap model attempts the task; the strong model finishes only what the checks reject.
// Both are ordinary top-level sessions, so neither can silently downgrade or upgrade the other.
export const ESCALATION_MODELS = { cheap: 'gpt-5.6-luna', strong: 'gpt-5.6-sol' };

// ladder: escalation without an answer key. Two independent cheap attempts are compared file by file; the strong
// model is shown only the files they disagree on. The acceptance grader scores the outcome afterwards and never
// decides whether to escalate, because real work has no such grader.
export function changedFiles(project) {
  const run = args => spawnSync('git', ['-C', project, ...args], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  return [...new Set([...run(['diff', '--name-only', 'HEAD']), ...run(['ls-files', '--others', '--exclude-standard'])])].sort();
}

const normalized = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/[ \t]+$/gm, '').trim() : null);

// A file is disputed when the two attempts left different content in it, including when only one of them touched it.
export function disputedFiles(projectA, projectB) {
  const union = [...new Set([...changedFiles(projectA), ...changedFiles(projectB)])].sort();
  return union.filter(file => normalized(path.join(projectA, file)) !== normalized(path.join(projectB, file)));
}

export function arbitrationPrompt(prompts, disputed, otherDir) {
  return [
    'Two engineers worked on the request below independently, each in their own copy of this repository. They agree on everything except the files listed here.',
    '',
    'The request was:',
    ...prompts.map(prompt => `- ${prompt}`),
    '',
    `The first engineer's version of each disputed file is in place. The second engineer's version is under ${otherDir}/ at the same relative path; a file missing there means the second engineer left the original unchanged or did not create it.`,
    '',
    'Disputed files:',
    ...disputed.map(file => `- ${file}`),
    '',
    'For each disputed file, read what the request requires for that file from its own sources, decide what is correct (either version, or neither), and leave the correct content in place. Do not edit any file that is not in the list. Do not read the rest of the repository beyond what these files need.',
  ].join('\n');
}

// review-loop: the cheap model does the work, the strong model only reviews the diff, the cheap model repairs.
// Unlike cheap-first it needs no oracle: the trigger is a review, not a held-out acceptance check.
export function reviewPrompt(prompts) {
  return [
    'Another engineer has just worked on this request in this working tree. Their changes are uncommitted; see them with `git diff`.',
    '',
    'The request was:',
    ...prompts.map(prompt => `- ${prompt}`),
    '',
    'Review the work. Do not edit any file. Check every change against the request, and look for parts of the request that were left undone.',
    'Reply with a numbered list of concrete findings, each naming the file and what is wrong or missing. If you find nothing, reply exactly NO FINDINGS.',
  ].join('\n');
}

export function repairPrompt(findings) {
  return `A reviewer examined your work and reported the findings below. Verify each one against the sources, fix the ones that are right, and say which you rejected and why.\n\n${findings}`;
}

export function escalationPrompt(prompts, failure) {
  return [
    'A previous attempt by another model did not pass the acceptance checks. Its work is already in this working tree.',
    '',
    'Original request:',
    ...prompts.map(prompt => `- ${prompt}`),
    '',
    `What the checks reported: ${failure}`,
    '',
    'Inspect what is there, finish the work and make the checks pass. Do not change the acceptance criteria.',
  ].join('\n');
}

// The fleet is the sibling approach in this repository: a coordinator that dispatches cheap in-session subagents.
function installFleet(project, force = false) {
  const installer = path.join(pluginRoot, '../scripts/install.mjs');
  if (!fs.existsSync(installer)) throw new Error('The fleet arm needs the agent-setup-copilot repository checkout around this plugin.');
  const run = spawnSync(process.execPath, [installer, '--host', 'cli', '--dest', project, ...(force ? ['--force'] : [])], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`Fleet install failed: ${run.stderr.trim()}`);
}

// Your own repository and your own questions, asked in order in one conversation.
function ownScenario(args) {
  if (!args['--project'] || !args['--prompts']) throw new Error('--project and --prompts go together.');
  const project = path.resolve(args['--project']);
  if (!fs.existsSync(path.join(project, '.git'))) throw new Error('--project must be the root of a git repository.');
  const prompts = fs.readFileSync(args['--prompts'], 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!prompts.length) throw new Error('--prompts has no prompts. Put one per line.');
  // Nothing can check these answers automatically; read the transcripts before trusting a saving.
  return { name: path.basename(project), project, prompts, check: () => true, unchecked: true };
}

const answered = (...patterns) => ({ answer }) => patterns.every(pattern => pattern.test(answer));

export const SCENARIOS = [
  { name: 'find-a-value',
    prompt: 'In src/delivery-service.mjs, how many times is a delivery retried, how long is the wait between attempts, and which function does the retrying?',
    check: answered(/\b7\b/, /250/, /retryDelivery/) },
  { name: 'mid-size-file',
    prompt: 'In src/pricing-rules.mjs, which SKU has the largest discount, how large is it, and which tiers exist?',
    check: answered(/SKU-077/, /\b40\b/, /platinum/i) },
  { name: 'summarise-big-file',
    prompt: 'Summarise what src/delivery-service.mjs does. Name the event topics it handles and any function that is not an event handler.',
    check: answered(/invoice/i, /payout/i, /retryDelivery/) },
  { name: 'cross-file-question',
    prompt: 'Using src/delivery-service.mjs, src/order-service.mjs and src/user-service.mjs: which OrderService method calls into the delivery service, which delivery function does it call, and which UserService method must pass first?',
    check: answered(/submitOrder/, /retryDelivery/, /isActive/) },
  { name: 'generate-tests',
    prompt: 'Write node:test unit tests for UserService in src/user-service.mjs, following the conventions of tests/order-service.test.mjs. Save them as tests/user-service.test.mjs.',
    check: ({ dir }) => fs.existsSync(path.join(dir, 'tests/user-service.test.mjs'))
      && spawnSync(process.execPath, ['--test', 'tests/user-service.test.mjs'], { cwd: dir, timeout: 60000 }).status === 0 },
  // One model call, no file needed: its input token count is the session's starting context.
  { name: 'context-probe',
    prompt: 'Reply with exactly the word READY. Do not use any tool.',
    check: answered(/READY/) },
  // A working session: eight questions in one conversation, so whatever was read early is carried by every later call.
  { name: 'long-session',
    prompts: [
      'Summarise what src/delivery-service.mjs does. Name the event topics it handles and any function that is not an event handler.',
      'How does delivery retrying work there? Give the retry count and the wait between attempts.',
      'Which OrderService method ships an order, and what has to be true before it does?',
      'In src/pricing-rules.mjs, which SKU has the largest discount and how large is it?',
      'What would happen to submitOrder if RETRY_LIMIT were set to 0?',
      'List the UserService methods and the errors each one can throw.',
      'tests/order-service.test.mjs: what is covered and what is missing for submitOrder?',
      'Write a short architecture overview of this project that names the key functions and how they depend on each other.',
    ],
    answerChecks: [
      answered(...TOPICS.map(topic => new RegExp(`\\b${topic}\\b`, 'i')), /retryDelivery/),
      answered(/\b7\b/, /250/),
      answered(/submitOrder/, /active/i),
      answered(/SKU-077/, /\b40\b/),
      answered(/throw|reject|error/i, /false|unshipped|not.*shipped|never.*shipped/i),
      answered(/createUser/, /getUser/, /deactivateUser/, /isActive/, /already exists|duplicate/i, /not found|unknown|missing/i),
      answered(/inactive/i, /success|active|ship/i, /missing|not.*test|not.*cover|no.*test|lack|gap/i),
      answered(/UserService/, /OrderService/, /retryDelivery/, /isActive/),
    ],
    check: answered(/\b7\b/, /250/, /retryDelivery/, /submitOrder/, /isActive/, /SKU-077/) },
];

// Tasks with a root cause in a different file from the symptom, graded by a
// held-out test suite the session never sees. Loaded from experiments/ so the
// shipped plugin does not depend on the experiment fixtures.
async function loadHardScenarios() {
  const module = path.join(pluginRoot, '../experiments/hard-fixture.mjs');
  if (!fs.existsSync(module)) return [];
  const { buildHardDebug, buildHardRefactor, checkWithHeldOut } = await import(pathToFileURL(module).href);
  const audit = path.join(pluginRoot, '../experiments/spec-audit/fixture.mjs');
  const { buildSpecAudit, gradeSpecAudit, SPEC_AUDIT_PROMPT } = fs.existsSync(audit) ? await import(pathToFileURL(audit).href) : {};
  const xl = path.join(pluginRoot, '../experiments/spec-audit-xl/generate.mjs');
  const { buildXl, gradeXl, XL_PROMPT } = fs.existsSync(xl) ? await import(pathToFileURL(xl).href) : {};
  return [
    // The same audit across 24 near-identical carriers whose specifications legitimately differ.
    ...(buildXl ? [{ name: 'spec-audit-xl', build: dest => buildXl(dest), prompt: XL_PROMPT,
      // The objective gate real work would have: the repository's own tests, nothing held out.
      gate: dest => { const tests = fs.readdirSync(path.join(dest, 'carriers')).flatMap(c => fs.readdirSync(path.join(dest, 'carriers', c, 'tests')).map(t => `carriers/${c}/tests/${t}`));
        return spawnSync(process.execPath, ['--test', ...tests], { cwd: dest, timeout: 300000 }).status === 0; },
      check: () => false, grade: gradeXl }] : []),
    // No failing test to anchor on: seven spec violations behind a green suite, scored per violation.
    ...(buildSpecAudit ? [{ name: 'spec-audit', build: dest => buildSpecAudit(dest), prompt: SPEC_AUDIT_PROMPT,
      check: ({ dir }) => gradeSpecAudit(dir).passed, grade: gradeSpecAudit }] : []),
    { name: 'hard-debug',
      build: buildHardDebug,
      prompt: 'One test in tests/billing.test.mjs fails. Find why and fix it properly, so the whole suite passes. Do not change the tests.',
      check: ({ dir }) => checkWithHeldOut('hard-debug', dir).passed,
      grade: dir => checkWithHeldOut('hard-debug', dir) },
    { name: 'hard-refactor',
      build: buildHardRefactor,
      prompt: 'Rename every pipeline stage in src/ to a "stage:" prefixed name, so "ingest" becomes "stage:ingest" and so on for every stage. Keep the existing tests passing and do not change the tests.',
      check: ({ dir }) => checkWithHeldOut('hard-refactor', dir).passed,
      grade: dir => checkWithHeldOut('hard-refactor', dir) },
  ];
}

export function checkAnswers(scenario, answers, dir) {
  const expected = scenario.prompts?.length ?? 1;
  if (answers.length !== expected || answers.some(answer => !answer.trim())) return false;
  if (scenario.answerChecks && !scenario.answerChecks.every((check, index) => check({ answer: answers[index], dir }))) return false;
  return Boolean(scenario.check({ answer: answers.join('\n'), dir }));
}

// USD per million tokens, default context tier, from docs/MODEL-COSTS.md (checked 2026-09-17).
// A model missing here is reported as unpriced; its credits are never silently treated as zero.
export const PRICES = {
  'gpt-5.6-luna': { input: 0.20, cacheRead: 0.02, cacheWrite: 0.25, output: 1.20 },
  'mai-code-1.1-flash': { input: 0.20, cacheRead: 0.02, cacheWrite: 0, output: 1.20 },
  'gpt-5.4-nano': { input: 0.20, cacheRead: 0.02, cacheWrite: 0, output: 1.25 },
  'gpt-5-mini': { input: 0.25, cacheRead: 0.025, cacheWrite: 0, output: 2.00 },
  'gpt-5.4-mini': { input: 0.75, cacheRead: 0.075, cacheWrite: 0, output: 4.50 },
  'gemini-3.8-flash': { input: 0.75, cacheRead: 0.075, cacheWrite: 0, output: 3.75 },
  'claude-haiku-4.5': { input: 1.00, cacheRead: 0.10, cacheWrite: 1.25, output: 5.00 },
  'claude-sonnet-5': { input: 2.00, cacheRead: 0.20, cacheWrite: 2.50, output: 10.00 },
  'gpt-5.6-terra': { input: 2.00, cacheRead: 0.20, cacheWrite: 2.50, output: 12.00 },
  'gpt-5.6-sol': { input: 4.00, cacheRead: 0.40, cacheWrite: 5.00, output: 20.00 },
  'claude-opus-5': { input: 5.00, cacheRead: 0.50, cacheWrite: 6.25, output: 25.00 },
  'gpt-6-astra': { input: 10.00, cacheRead: 1.00, cacheWrite: 12.50, output: 50.00 },
};

export const emptyBuckets = () => ({ uncached: 0, cached: 0, cacheWrite: 0, output: 0, priced: 0,
  billed: 0, residual: 0, reasoning: 0, unpriced: [] });

// Splits one usage file's credits into the four price buckets, per model, from tokenDetails.
// One credit = $0.01. `billed` is the CLI's own totalNanoAiu; `residual` is what the buckets do not explain.
export function bucketCredits(usage) {
  const out = emptyBuckets();
  for (const [model, metrics] of Object.entries(usage?.modelMetrics ?? {})) {
    const price = PRICES[String(model).toLowerCase()];
    out.reasoning += metrics.usage?.reasoningTokens ?? 0;
    if (!price) { if (!out.unpriced.includes(model)) out.unpriced.push(model); continue; }
    const d = metrics.tokenDetails ?? {};
    const n = key => d[key]?.tokenCount ?? 0;
    // Credits, not dollars: USD-per-million / 1e6 * 100.
    const credits = (count, rate) => (count * rate) / 1e4;
    out.uncached += credits(n('input'), price.input);
    out.cached += credits(n('cache_read'), price.cacheRead);
    out.cacheWrite += credits(n('cache_write'), price.cacheWrite);
    out.output += credits(n('output'), price.output);
  }
  out.priced = out.uncached + out.cached + out.cacheWrite + out.output;
  out.billed = (usage?.totalNanoAiu ?? 0) / 1e9;
  out.residual = out.billed - out.priced;
  return out;
}

export function addBuckets(a, b) {
  const out = emptyBuckets();
  for (const key of ['uncached', 'cached', 'cacheWrite', 'output', 'priced', 'billed', 'residual', 'reasoning']) out[key] = a[key] + b[key];
  out.unpriced = [...new Set([...a.unpriced, ...b.unpriced])];
  return out;
}

const tokens = usage => ({
  input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0,
  cacheRead: usage?.cacheReadTokens ?? 0, cacheWrite: usage?.cacheWriteTokens ?? 0,
  reasoning: usage?.reasoningTokens ?? 0,
});

// Reduces one CLI usage file to the counters the report compares.
export function summarizeUsage(usage) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, modelCalls: 0 };
  for (const metrics of Object.values(usage?.modelMetrics ?? {})) {
    const t = tokens(metrics.usage);
    for (const key of Object.keys(t)) total[key] += t[key];
    total.modelCalls += metrics.requests?.count ?? 0;
  }
  return { ...total, premiumRequests: usage?.totalPremiumRequestCost ?? 0, nanoAiu: usage?.totalNanoAiu ?? 0,
    apiMs: usage?.totalApiDurationMs ?? 0 };
}

// Splits one usage file into the conversation's own agent and any in-session subagents it dispatched.
export function splitAgents(usage) {
  const agents = Object.entries(usage?.agentMetrics ?? {});
  if (!agents.length) return { main: summarizeUsage(usage), subagents: summarizeUsage(null), subagentCount: 0 };
  const sum = list => list.map(([, metrics]) => summarizeUsage(metrics)).reduce(addUsage, summarizeUsage(null));
  const subagents = agents.filter(([name]) => name !== 'main');
  return { main: sum(agents.filter(([name]) => name === 'main')), subagents: sum(subagents), subagentCount: subagents.length };
}

export function addUsage(a, b) {
  return Object.fromEntries(Object.keys(a).map(key => [key, a[key] + b[key]]));
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Negative means the plugin arm used less.
export function change(baseline, shunt) {
  return baseline ? Math.round(((shunt - baseline) / baseline) * 100) : null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function runCopilot({ executable, dir, prompt, model, arm, sessionId, usageFile, workerUsageDir, transcript, timeoutMs, extraArgs = [], customInstructions = false }) {
  // One session id across the turns of a scenario makes each later prompt continue the same conversation.
  const args = ['-C', dir, '-p', prompt, `--session-id=${sessionId}`, '--allow-all-tools', '--allow-all-paths',
    ...(customInstructions ? [] : ['--no-custom-instructions']),
    '--no-ask-user', '--disable-builtin-mcps', '--output-format', 'json', '--stream', 'off', '--log-level', 'none',
    '--usage-output-file', usageFile];
  // The fleet coordinator pins its own model with a required policy, so --model would conflict with it.
  if (arm === 'fleet' || arm === 'economy') args.push('--agent', arm === 'fleet' ? 'subagent-fleet' : 'economy');
  else if (model) args.push('--model', model);
  if (arm === 'shunt') args.push('--plugin-dir', pluginRoot);
  // Typed experiment options only; never a shell-evaluated string and never an accounting flag.
  args.push(...extraArgs);
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(executable, args, { cwd: dir, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, SHUNT_COPILOT_USAGE_DIR: workerUsageDir } });
    const out = fs.createWriteStream(transcript);
    child.stdout.pipe(out);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', () => resolve({ exitCode: -1, wallMs: Date.now() - started }));
    child.on('close', code => { clearTimeout(timer); out.end(() => resolve({ exitCode: code, wallMs: Date.now() - started })); });
  });
}

function readTranscript(file) {
  const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const final = events.findLast(e => e.type === 'assistant.message' && e.data?.phase === 'final_answer');
  const calls = events.filter(e => e.type === 'tool.execution_start');
  return {
    answer: final?.data?.content ?? '',
    toolCalls: calls.length,
    redirects: events.filter(e => e.type === 'tool.execution_complete' && JSON.stringify(e.data).includes('SHUNT_COPILOT_READ_REDIRECT')).length,
  };
}

async function runArm(scenario, arm, run, options) {
  const dir = path.join(options.out, `${scenario.name}-${arm}-${run}`);
  if (scenario.project) {
    // A local clone is a cheap throwaway copy of the committed state; the real checkout is never touched.
    const clone = spawnSync('git', ['clone', '--quiet', '--local', scenario.project, path.join(dir, 'project')], { encoding: 'utf8' });
    if (clone.status !== 0) throw new Error(`Could not clone --project: ${clone.stderr.trim()}`);
  } else if (scenario.build) await scenario.build(path.join(dir, 'project'));
  else buildFixture(path.join(dir, 'project'));
  const workerUsageDir = path.join(dir, 'worker-usage');
  fs.mkdirSync(workerUsageDir);
  const project = path.join(dir, 'project');
  if (arm === 'fleet' || arm === 'economy') installFleet(project, Boolean(scenario.project));
  const prompts = [...(scenario.prompts ?? [scenario.prompt])];
  if (options.promptPrefix) prompts[0] = `${options.promptPrefix}\n\n${prompts[0]}`;
  const sessionId = randomUUID();
  const cheapModel = options.cheapModel ?? ESCALATION_MODELS.cheap, strongModel = options.strongModel ?? ESCALATION_MODELS.strong;
  const armModel = ['cheap-first', 'review-loop', 'ladder'].includes(arm) ? cheapModel : options.model;
  const extraUsages = [];
  let ladder = null, secondAttempt = null;
  if (arm === 'ladder') {
    const projectB = path.join(dir, 'project-b');
    await scenario.build(projectB);
    // The second attempt runs concurrently in its own copy and its own session; neither sees the other.
    secondAttempt = (async () => {
      const session = randomUUID();
      let usageFile = null, exit = 0;
      for (const [index, prompt] of prompts.entries()) {
        usageFile = path.join(dir, `usage-b-${index + 1}.json`);
        const turn = await runCopilot({ ...options, model: armModel, dir: projectB, prompt, arm, sessionId: session, usageFile, workerUsageDir,
          transcript: path.join(dir, `transcript-b-${index + 1}.jsonl`) });
        exit ||= turn.exitCode;
        if (turn.exitCode !== 0) break;
      }
      return { projectB, usage: readJson(usageFile), exit };
    })();
  }
  let exitCode = 0, wallMs = 0, subagentCount = 0, main = summarizeUsage(null), subagents = summarizeUsage(null);
  const seen = { answer: '', toolCalls: 0, redirects: 0 };
  const turns = [];
  const answers = [];
  let lastUsageFile = null;
  let firstCallInput = null;
  let escalationUsage = null;
  for (const [index, prompt] of prompts.entries()) {
    const suffix = prompts.length > 1 ? `-${index + 1}` : '';
    const usageFile = path.join(dir, `usage${suffix}.json`);
    const transcript = path.join(dir, `transcript${suffix}.jsonl`);
    if (index > 0 && options.turnGapSec) await new Promise(r => setTimeout(r, options.turnGapSec * 1000));
    const turn = await runCopilot({ ...options, model: armModel, dir: project, prompt, arm, sessionId, usageFile, workerUsageDir, transcript });
    lastUsageFile = usageFile;
    // A resumed session's usage file is cumulative, so the latest file is the running total, not one turn.
    const split = splitAgents(readJson(usageFile));
    const before = main.nanoAiu + subagents.nanoAiu, beforeInput = main.input;
    ({ main, subagents, subagentCount } = split);
    wallMs += turn.wallMs;
    exitCode ||= turn.exitCode;
    const read = readTranscript(transcript);
    answers.push(read.answer);
    seen.answer += `${read.answer}\n`;
    seen.toolCalls += read.toolCalls;
    seen.redirects += read.redirects;
    fs.appendFileSync(path.join(dir, 'answers.md'), `## ${index + 1}. ${prompt}\n\n${read.answer}\n\n`);
    const usageJson = readJson(usageFile);
    if (index === 0) {
      // Exact only when the first turn made a single model call; otherwise this is not a starting-context measure.
      firstCallInput = split.main.modelCalls === 1 ? split.main.input : null;
    }
    turns.push({ turn: index + 1, mainInput: main.input - beforeInput, nanoAiu: main.nanoAiu + subagents.nanoAiu - before,
      buckets: bucketCredits(usageJson) });
    if (turn.exitCode !== 0) break;
  }
  if (arm === 'ladder') {
    const started = Date.now();
    const second = await secondAttempt;
    extraUsages.push(second.usage);
    const gate = project_ => (scenario.gate ? Boolean(scenario.gate(project_)) : true);
    const gateA = exitCode === 0 && gate(project), gateB = second.exit === 0 && gate(second.projectB);
    // Work from whichever attempt passes the objective gates; with none passing, every changed file is in dispute.
    if (!gateA && gateB) for (const file of [...new Set([...changedFiles(project), ...changedFiles(second.projectB)])]) {
      const from = path.join(second.projectB, file), to = path.join(project, file), keep = path.join(dir, 'attempt-a', file);
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      if (fs.existsSync(to)) fs.copyFileSync(to, keep);
      if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); } else fs.rmSync(to, { force: true });
    }
    const otherProject = !gateA && gateB ? path.join(dir, 'attempt-a') : second.projectB;
    const disputed = !gateA && gateB ? changedFiles(project).filter(file => normalized(path.join(project, file)) !== normalized(path.join(otherProject, file)))
      : disputedFiles(project, second.projectB);
    ladder = { gateA, gateB, disputed, escalated: false, arbitrationCredits: 0, changedA: changedFiles(project).length, changedB: changedFiles(second.projectB).length };
    if (disputed.length || (!gateA && !gateB)) {
      ladder.escalated = true;
      const otherDir = '.ladder-other';
      for (const file of disputed) {
        const from = path.join(otherProject, file), to = path.join(project, otherDir, file);
        if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
      }
      const usageFile = path.join(dir, 'usage-arbitration.json');
      const turn = await runCopilot({ ...options, model: strongModel, dir: project, arm, sessionId: randomUUID(), usageFile, workerUsageDir,
        prompt: arbitrationPrompt(scenario.prompts ?? [scenario.prompt], disputed.length ? disputed : changedFiles(project), otherDir),
        transcript: path.join(dir, 'transcript-arbitration.jsonl') });
      exitCode ||= turn.exitCode;
      const usage = readJson(usageFile);
      extraUsages.push(usage);
      ladder.arbitrationCredits = (usage?.totalNanoAiu ?? 0) / 1e9;
      fs.rmSync(path.join(project, otherDir), { recursive: true, force: true });
      fs.appendFileSync(path.join(dir, 'answers.md'), `## arbitration (${strongModel})\n\n${readTranscript(path.join(dir, 'transcript-arbitration.jsonl')).answer}\n\n`);
      ladder.gateAfter = gate(project);
    }
    // Attempts ran concurrently, so wall time is the longer of the two plus arbitration, which this approximates.
    wallMs += Date.now() - started;
  }
  let reviewUsage = null, reviewFindings = null;
  if (arm === 'review-loop' && exitCode === 0) {
    const reviewFile = path.join(dir, 'usage-review.json');
    const review = await runCopilot({ ...options, model: strongModel, dir: project, prompt: reviewPrompt(scenario.prompts ?? [scenario.prompt]), arm,
      sessionId: randomUUID(), usageFile: reviewFile, workerUsageDir, transcript: path.join(dir, 'transcript-review.jsonl') });
    wallMs += review.wallMs; exitCode ||= review.exitCode;
    reviewUsage = readJson(reviewFile);
    reviewFindings = readTranscript(path.join(dir, 'transcript-review.jsonl')).answer;
    fs.appendFileSync(path.join(dir, 'answers.md'), `## review (${strongModel})\n\n${reviewFindings}\n\n`);
    if (exitCode === 0 && reviewFindings.trim() && !/^\s*NO FINDINGS\s*$/i.test(reviewFindings)) {
      // The repair continues the cheap model's own session, so its usage file stays cumulative.
      const usageFile = path.join(dir, 'usage-repair.json');
      const repair = await runCopilot({ ...options, model: armModel, dir: project, prompt: repairPrompt(reviewFindings), arm, sessionId,
        usageFile, workerUsageDir, transcript: path.join(dir, 'transcript-repair.jsonl') });
      wallMs += repair.wallMs; exitCode ||= repair.exitCode;
      ({ main, subagents, subagentCount } = splitAgents(readJson(usageFile)));
      lastUsageFile = usageFile;
      const read = readTranscript(path.join(dir, 'transcript-repair.jsonl'));
      answers[answers.length - 1] = `${answers[answers.length - 1]}\n${read.answer}`;
      fs.appendFileSync(path.join(dir, 'answers.md'), `## repair (${armModel})\n\n${read.answer}\n\n`);
    }
  }
  // E13: run the acceptance checks now, and hand the failing working tree to the strong model once.
  let escalated = false;
  if (arm === 'cheap-first' && exitCode === 0) {
    let cheapPassed = false;
    try { cheapPassed = scenario.grade ? (await scenario.grade(project)).passed : checkAnswers(scenario, answers, project); } catch { cheapPassed = false; }
    if (!cheapPassed) {
      escalated = true;
      const usageFile = path.join(dir, 'usage-escalation.json');
      const transcript = path.join(dir, 'transcript-escalation.jsonl');
      const turn = await runCopilot({ ...options, model: strongModel, dir: project,
        prompt: escalationPrompt(prompts, 'the automated acceptance checks did not pass'), arm,
        sessionId: randomUUID(), usageFile, workerUsageDir, transcript });
      wallMs += turn.wallMs;
      exitCode ||= turn.exitCode;
      const read = readTranscript(transcript);
      // The escalation answers the same request, so its answer replaces the cheap attempt's last one.
      answers[answers.length - 1] = `${answers[answers.length - 1]}\n${read.answer}`;
      seen.toolCalls += read.toolCalls;
      fs.appendFileSync(path.join(dir, 'answers.md'), `## escalation (${ESCALATION_MODELS.strong})\n\n${read.answer}\n\n`);
      escalationUsage = readJson(usageFile);
    }
  }
  const workerFiles = fs.readdirSync(workerUsageDir);
  // "Worker" is every cheap helper: Shunt's separate CLI sessions and the fleet's in-session subagents.
  const worker = workerFiles.map(file => summarizeUsage(readJson(path.join(workerUsageDir, file))))
    .reduce(addUsage, extraUsages.map(summarizeUsage).reduce(addUsage, addUsage(addUsage(subagents, summarizeUsage(escalationUsage)), summarizeUsage(reviewUsage))));
  // The session usage file already aggregates in-session subagents; separate worker CLI sessions are added on top.
  const buckets = workerFiles.map(file => bucketCredits(readJson(path.join(workerUsageDir, file))))
    .reduce(addBuckets, extraUsages.map(bucketCredits).reduce(addBuckets, addBuckets(addBuckets(bucketCredits(readJson(lastUsageFile)), bucketCredits(escalationUsage)), bucketCredits(reviewUsage))));
  let correct = false, grade = null, gradeDetail = null;
  if (scenario.grade) {
    try {
      const graded = await scenario.grade(project);
      grade = graded.stage; correct = exitCode === 0 && graded.passed;
      if (typeof graded.score === 'number') gradeDetail = { score: graded.score, of: graded.of, fixed: graded.fixed, missed: graded.missed, regression: graded.regression };
    } catch { correct = false; }
  } else {
    try { correct = exitCode === 0 && checkAnswers(scenario, answers, project); } catch { /* counts as wrong */ }
  }
  return { scenario: scenario.name, arm, run, exitCode, wallMs, correct, unchecked: Boolean(scenario.unchecked), delegations: workerFiles.length + subagentCount,
    redirects: seen.redirects, toolCalls: seen.toolCalls, turns, main, worker, buckets, firstCallInput, escalated: escalated || Boolean(ladder?.escalated), ladder, grade, gradeDetail, reviewCredits: (reviewUsage?.totalNanoAiu ?? 0) / 1e9,
    escalationCredits: (escalationUsage?.totalNanoAiu ?? 0) / 1e9,
    label: options.label ?? arm, total: addUsage(main, worker) };
}

const pick = (rows, read) => median(rows.map(read));
const fmt = value => Math.round(value).toLocaleString('en-US');
const pct = value => (value === null ? 'n/a' : `${value > 0 ? '+' : ''}${value}%`);

export function report(results) {
  const lines = [];
  const header = ['Scenario', 'Variant', 'Main calls', 'Main in', 'Main out', 'Worker in', 'Worker out', 'AI credits',
    'Uncached', 'Cached', 'Cache write', 'Output', 'Residual', 'Reasoning', '1st-call in', 'Seconds', 'Delegated', 'Correct'];
  lines.push(`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`);
  const summary = [];
  const unpriced = new Set();
  for (const name of [...new Set(results.map(r => r.scenario))]) {
    const scoped = results.filter(r => r.scenario === name);
    const labels = [...new Set(scoped.map(r => r.label ?? r.arm))];
    const variants = {};
    for (const label of labels) {
      const rows = scoped.filter(r => (r.label ?? r.arm) === label);
      const bucket = read => pick(rows, r => read(r.buckets ?? emptyBuckets()));
      for (const row of rows) for (const model of row.buckets?.unpriced ?? []) unpriced.add(model);
      const first = rows.map(r => r.firstCallInput).filter(v => typeof v === 'number');
      variants[label] = {
        mainIn: pick(rows, r => r.main.input), mainOut: pick(rows, r => r.main.output),
        workerIn: pick(rows, r => r.worker.input), workerOut: pick(rows, r => r.worker.output),
        calls: pick(rows, r => r.main.modelCalls),
        // Copilot bills tokens as AI credits (1 credit = $0.01); the CLI reports them in billionths.
        credits: pick(rows, r => r.total.nanoAiu) / 1e9,
        uncached: bucket(b => b.uncached), cached: bucket(b => b.cached),
        cacheWrite: bucket(b => b.cacheWrite), outputCredits: bucket(b => b.output),
        residual: bucket(b => b.residual), reasoning: bucket(b => b.reasoning),
        firstCallInput: first.length ? median(first) : null,
        seconds: pick(rows, r => r.wallMs) / 1000,
        delegated: `${rows.filter(r => r.delegations > 0 || r.escalated).length}/${rows.length}`,
        correct: rows[0].unchecked ? 'not checked' : `${rows.filter(r => r.correct).length}/${rows.length}`,
      };
      const a = variants[label];
      lines.push(`| ${name} | ${label} | ${a.calls} | ${fmt(a.mainIn)} | ${fmt(a.mainOut)} | ${fmt(a.workerIn)} | ${fmt(a.workerOut)} | ${a.credits.toFixed(3)} | ${a.uncached.toFixed(3)} | ${a.cached.toFixed(3)} | ${a.cacheWrite.toFixed(3)} | ${a.outputCredits.toFixed(3)} | ${a.residual.toFixed(3)} | ${fmt(a.reasoning)} | ${a.firstCallInput === null ? 'n/a' : fmt(a.firstCallInput)} | ${fmt(a.seconds)} | ${a.delegated} | ${a.correct} |`);
    }
    const base = variants.baseline ? 'baseline' : labels[0];
    for (const label of labels.filter(l => l !== base)) {
      summary.push(`| ${name} | ${label} | ${pct(change(variants[base].credits, variants[label].credits))} | ${pct(change(variants[base].mainIn, variants[label].mainIn))} | ${pct(change(variants[base].mainOut, variants[label].mainOut))} | ${pct(change(variants[base].calls, variants[label].calls))} | ${pct(change(variants[base].seconds, variants[label].seconds))} |`);
    }
  }
  if (summary.length) {
    lines.push('', 'Change against the first variant (negative = used less; AI credits include workers and subagents):', '',
      '| Scenario | Variant | AI credits | Main input tokens | Main output tokens | Main model calls | Time |', '|---|---|---|---|---|---|---|', ...summary);
  }
  if (unpriced.size) lines.push('', `Unpriced models, excluded from the bucket split: ${[...unpriced].join(', ')}. Their credits are still in "AI credits".`);
  return lines.join('\n');
}

// Typed experiment options only. Nothing here may change model selection, usage accounting or permissions.
export function buildExtraArgs(args, disableUserMcps, mcpConfigPath = path.join(os.homedir(), '.copilot/mcp-config.json')) {
  const extra = [];
  if (args['--reasoning-effort']) {
    const level = args['--reasoning-effort'];
    if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level)) throw new Error(`Unknown --reasoning-effort: ${level}`);
    extra.push('--reasoning-effort', level);
  }
  if (args['--auto-tier']) {
    if (!['efficiency', 'balance', 'intelligence'].includes(args['--auto-tier'])) throw new Error(`Unknown --auto-tier: ${args['--auto-tier']}`);
    extra.push('--auto-tier', args['--auto-tier']);
  }
  if (args['--context']) {
    if (!['default', 'long_context'].includes(args['--context'])) throw new Error(`Unknown --context: ${args['--context']}`);
    extra.push('--context', args['--context']);
  }
  if (args['--tools']) {
    const tools = args['--tools'].split(',').map(t => t.trim()).filter(Boolean);
    if (!tools.length) throw new Error('--tools needs at least one tool name.');
    if (tools.some(t => !/^[A-Za-z0-9_.:-]+$/.test(t))) throw new Error('--tools takes plain tool identifiers.');
    extra.push('--available-tools', ...tools);
  }
  if (disableUserMcps) {
    const servers = Object.keys(readJson(mcpConfigPath)?.mcpServers ?? {});
    for (const server of servers) extra.push('--disable-mcp-server', server);
  }
  return extra;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const disableUserMcps = argv.includes('--disable-user-mcps');
  const customInstructions = argv.includes('--custom-instructions');
  const flags = ['--dry-run', '--disable-user-mcps', '--custom-instructions'];
  const args = parseArgs(argv.filter(a => !flags.includes(a)), ['--model', '--runs', '--scenario', '--arm', '--out', '--timeout-sec',
    '--project', '--prompts', '--reasoning-effort', '--auto-tier', '--context', '--tools', '--turn-gap-sec', '--label', '--prompt-prefix-file', '--cheap-model', '--strong-model']);
  const runs = Number(args['--runs'] ?? 1);
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer.');
  const timeoutMs = Number(args['--timeout-sec'] ?? 600) * 1000;
  if (!(timeoutMs > 0)) throw new Error('--timeout-sec must be a positive number.');
  // The long session costs several times a single question, so it only runs when asked for by name.
  const all = [...SCENARIOS, ...await loadHardScenarios()];
  const scenarios = args['--project'] || args['--prompts'] ? [ownScenario(args)] : args['--scenario'] ? all.filter(s => s.name === args['--scenario']) : SCENARIOS.filter(s => !s.prompts);
  if (!scenarios.length) throw new Error(`Unknown scenario. Choose one of: ${all.map(s => s.name).join(', ')}`);
  const arms = args['--arm'] ? args['--arm'].split(',') : ['baseline', 'shunt'];
  if (arms.some(arm => !ARMS.includes(arm))) throw new Error(`--arm takes a comma-separated list of: ${ARMS.join(', ')}`);
  if (arms.includes('fleet')) console.log('The fleet arm uses the coordinator\'s pinned model (gpt-5.6-sol); pass --model gpt-5.6-sol so the other arms match it.');
  if (arms.includes('economy')) console.log('The economy arm uses direct gpt-5.6-luna execution; --model applies only to baseline and shunt.');
  if (arms.includes('cheap-first')) console.log(`The cheap-first arm starts on ${ESCALATION_MODELS.cheap} and escalates a failing check once to ${ESCALATION_MODELS.strong}; "Delegated" counts escalations.`);
  const extraArgs = buildExtraArgs(args, disableUserMcps);
  const gapSec = args['--turn-gap-sec'] ? Number(args['--turn-gap-sec']) : 0;
  if (!(gapSec >= 0) || !Number.isFinite(gapSec)) throw new Error('--turn-gap-sec must be a non-negative number.');
  if (extraArgs.length) console.log(`Extra CLI arguments for every arm: ${extraArgs.join(' ')}`);
  if (gapSec) console.log(`Sleeping ${gapSec}s between turns of a multi-turn scenario.`);
  if (customInstructions) console.log('Custom instructions are ENABLED for this batch (AGENTS.md / copilot-instructions.md are loaded).');
  const worker = config().model;
  const sessions = scenarios.length * arms.length * runs;
  console.log(`Main model: ${args['--model'] ?? '(your Copilot CLI default)'} | worker model: ${worker}`);
  console.log(`${sessions} main Copilot sessions (${scenarios.length} scenarios x ${arms.length} arms x ${runs} runs), plus one worker session per delegation.`);
  if (dryRun) { console.log('Dry run: nothing was sent.'); return; }

  const out = path.resolve(args['--out'] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-benchmark-')));
  fs.mkdirSync(out, { recursive: true });
  const options = { out, model: args['--model'], executable: process.env.SHUNT_COPILOT_BIN || 'copilot', timeoutMs,
    extraArgs, customInstructions, label: args['--label'], turnGapSec: gapSec, cheapModel: args['--cheap-model'], strongModel: args['--strong-model'],
    promptPrefix: args['--prompt-prefix-file'] ? fs.readFileSync(args['--prompt-prefix-file'], 'utf8').trim() : null };
  const results = [];
  for (const scenario of scenarios) for (let run = 1; run <= runs; run++) for (const arm of arms) {
    process.stdout.write(`- ${scenario.name} / ${arm} / run ${run} ... `);
    const result = await runArm(scenario, arm, run, options);
    results.push(result);
    console.log(`${result.exitCode === 0 ? 'done' : `exit ${result.exitCode}`}, ${fmt(result.wallMs / 1000)}s, main input ${fmt(result.main.input)} tokens`);
  }
  const table = report(results);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ model: args['--model'] ?? null, worker, results }, null, 2));
  fs.writeFileSync(path.join(out, 'report.md'), `${table}\n`);
  console.log(`\n${table}\n\nRaw results, transcripts and generated projects: ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { mainError(error); }
}
