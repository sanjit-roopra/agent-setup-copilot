// Live A/B benchmark: the same prompt through Copilot CLI with and without this plugin.
// Every number comes from the CLI's own --usage-output-file, not from a characters/4 estimate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
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
];

const tokens = usage => ({
  input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0,
  cacheRead: usage?.cacheReadTokens ?? 0, cacheWrite: usage?.cacheWriteTokens ?? 0,
});

// Reduces one CLI usage file to the counters the report compares.
export function summarizeUsage(usage) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, modelCalls: 0 };
  for (const metrics of Object.values(usage?.modelMetrics ?? {})) {
    const t = tokens(metrics.usage);
    for (const key of Object.keys(t)) total[key] += t[key];
    total.modelCalls += metrics.requests?.count ?? 0;
  }
  return { ...total, premiumRequests: usage?.totalPremiumRequestCost ?? 0, nanoAiu: usage?.totalNanoAiu ?? 0,
    apiMs: usage?.totalApiDurationMs ?? 0 };
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

function runCopilot({ executable, dir, prompt, model, withPlugin, usageFile, workerUsageDir, transcript, timeoutMs }) {
  const args = ['-C', dir, '-p', prompt, '--allow-all-tools', '--allow-all-paths', '--no-custom-instructions',
    '--no-ask-user', '--disable-builtin-mcps', '--output-format', 'json', '--stream', 'off', '--log-level', 'none',
    '--usage-output-file', usageFile];
  if (model) args.push('--model', model);
  if (withPlugin) args.push('--plugin-dir', pluginRoot);
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
  buildFixture(path.join(dir, 'project'));
  const workerUsageDir = path.join(dir, 'worker-usage');
  fs.mkdirSync(workerUsageDir);
  const project = path.join(dir, 'project');
  const transcript = path.join(dir, 'transcript.jsonl');
  const { exitCode, wallMs } = await runCopilot({ ...options, dir: project, prompt: scenario.prompt,
    withPlugin: arm === 'shunt', usageFile: path.join(dir, 'usage.json'), workerUsageDir, transcript });
  const main = summarizeUsage(readJson(path.join(dir, 'usage.json')));
  const workerFiles = fs.readdirSync(workerUsageDir);
  const worker = workerFiles.map(file => summarizeUsage(readJson(path.join(workerUsageDir, file))))
    .reduce(addUsage, summarizeUsage(null));
  const seen = readTranscript(transcript);
  let correct = false;
  try { correct = exitCode === 0 && Boolean(scenario.check({ answer: seen.answer, dir: project })); } catch { /* counts as wrong */ }
  return { scenario: scenario.name, arm, run, exitCode, wallMs, correct, delegations: workerFiles.length,
    redirects: seen.redirects, toolCalls: seen.toolCalls, main, worker, total: addUsage(main, worker) };
}

const pick = (rows, read) => median(rows.map(read));
const fmt = value => Math.round(value).toLocaleString('en-US');
const pct = value => (value === null ? 'n/a' : `${value > 0 ? '+' : ''}${value}%`);

export function report(results) {
  const lines = [];
  const header = ['Scenario', 'Arm', 'Main calls', 'Main in', 'Main out', 'Worker in', 'Worker out', 'AI credits', 'Seconds', 'Delegated', 'Correct'];
  lines.push(`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`);
  const summary = [];
  for (const name of [...new Set(results.map(r => r.scenario))]) {
    const arms = {};
    for (const arm of ['baseline', 'shunt']) {
      const rows = results.filter(r => r.scenario === name && r.arm === arm);
      if (!rows.length) continue;
      arms[arm] = {
        mainIn: pick(rows, r => r.main.input), mainOut: pick(rows, r => r.main.output),
        workerIn: pick(rows, r => r.worker.input), workerOut: pick(rows, r => r.worker.output),
        calls: pick(rows, r => r.main.modelCalls),
        // Copilot bills tokens as AI credits (1 credit = $0.01); the CLI reports them in billionths.
        credits: pick(rows, r => r.total.nanoAiu) / 1e9,
        seconds: pick(rows, r => r.wallMs) / 1000,
        delegated: `${rows.filter(r => r.delegations > 0).length}/${rows.length}`,
        correct: `${rows.filter(r => r.correct).length}/${rows.length}`,
      };
      const a = arms[arm];
      lines.push(`| ${name} | ${arm} | ${a.calls} | ${fmt(a.mainIn)} | ${fmt(a.mainOut)} | ${fmt(a.workerIn)} | ${fmt(a.workerOut)} | ${a.credits.toFixed(3)} | ${fmt(a.seconds)} | ${a.delegated} | ${a.correct} |`);
    }
    if (arms.baseline && arms.shunt) {
      summary.push(`| ${name} | ${pct(change(arms.baseline.credits, arms.shunt.credits))} | ${pct(change(arms.baseline.mainIn, arms.shunt.mainIn))} | ${pct(change(arms.baseline.mainOut, arms.shunt.mainOut))} | ${pct(change(arms.baseline.calls, arms.shunt.calls))} | ${pct(change(arms.baseline.seconds, arms.shunt.seconds))} |`);
    }
  }
  if (summary.length) {
    lines.push('', 'Change with the plugin (negative = plugin used less; AI credits include the worker):', '',
      '| Scenario | AI credits | Main input tokens | Main output tokens | Main model calls | Time |', '|---|---|---|---|---|---|', ...summary);
  }
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const args = parseArgs(argv.filter(a => a !== '--dry-run'), ['--model', '--runs', '--scenario', '--arm', '--out', '--timeout-sec']);
  const runs = Number(args['--runs'] ?? 1);
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer.');
  const timeoutMs = Number(args['--timeout-sec'] ?? 600) * 1000;
  if (!(timeoutMs > 0)) throw new Error('--timeout-sec must be a positive number.');
  const scenarios = args['--scenario'] ? SCENARIOS.filter(s => s.name === args['--scenario']) : SCENARIOS;
  if (!scenarios.length) throw new Error(`Unknown scenario. Choose one of: ${SCENARIOS.map(s => s.name).join(', ')}`);
  const arms = args['--arm'] ? [args['--arm']] : ['baseline', 'shunt'];
  if (arms.some(arm => arm !== 'baseline' && arm !== 'shunt')) throw new Error('--arm must be baseline or shunt.');
  const worker = config().model;
  const sessions = scenarios.length * arms.length * runs;
  console.log(`Main model: ${args['--model'] ?? '(your Copilot CLI default)'} | worker model: ${worker}`);
  console.log(`${sessions} main Copilot sessions (${scenarios.length} scenarios x ${arms.length} arms x ${runs} runs), plus one worker session per delegation.`);
  if (dryRun) { console.log('Dry run: nothing was sent.'); return; }

  const out = path.resolve(args['--out'] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-benchmark-')));
  fs.mkdirSync(out, { recursive: true });
  const options = { out, model: args['--model'], executable: process.env.SHUNT_COPILOT_BIN || 'copilot', timeoutMs };
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
