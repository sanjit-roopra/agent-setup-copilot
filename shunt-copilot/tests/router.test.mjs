import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config, pluginRoot, readSources } from '../scripts/common.mjs';
import { evaluate } from '../scripts/hook.mjs';
import { invokeWorker, parseTranscript } from '../scripts/worker.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'small.txt'), 'small\n');
  fs.writeFileSync(path.join(root, 'large file.txt'), 'SOURCE_SENTINEL\n' + 'line\n'.repeat(399));
  return root;
}

const native = (cwd, args, name = 'view') => ({ cwd, toolName: name, toolArgs: args });
const vscode = (cwd, args, name = 'read_file') => ({ cwd, tool_name: name, tool_input: args });
const denied = result => result.permissionDecision === 'deny' && result.hookSpecificOutput.permissionDecision === 'deny';

for (const [host, input] of [
  ['CLI camelCase', root => native(root, { path: 'large file.txt' })],
  ['CLI serialized arguments', root => native(root, JSON.stringify({ path: 'large file.txt' }))],
  ['VS Code', root => vscode(root, { filePath: 'large file.txt', startLine: 1, endLine: 400 })],
  ['Copilot app PascalCase alias', root => vscode(root, { path: 'large file.txt' }, 'Read')],
]) {
  test(`${host} whole-file read redirects without returning source`, t => {
    const result = evaluate(input(fixture(t)));
    assert.ok(denied(result));
    assert.match(result.permissionDecisionReason, /bulk-read.mjs/);
    assert.doesNotMatch(JSON.stringify(result), /SOURCE_SENTINEL/);
  });
}

test('small files, directories and missing files defer to normal permissions', t => {
  const root = fixture(t);
  for (const file of ['small.txt', '.', 'missing']) assert.deepEqual(evaluate(native(root, { path: file })), {});
});

test('targeted read adapters allow small ranges without granting permission', t => {
  const root = fixture(t);
  for (const args of [{ view_range: [2, 5] }, { startLine: 2, endLine: 5 }, { offset: 2, limit: 4 }]) {
    assert.deepEqual(evaluate(native(root, { path: 'large file.txt', ...args })), {});
  }
});

test('unbounded, oversized and malformed ranges are not bypasses', t => {
  const root = fixture(t);
  for (const args of [{ view_range: [1, -1] }, { view_range: [1, 400] }, { offset: 1 },
    { limit: 400 }, { startLine: 1 }, { startLine: 10, endLine: 1 }, { view_range: ['1', '3'] }]) {
    assert.ok(denied(evaluate(native(root, { path: 'large file.txt', ...args }))));
  }
});

test('byte budget covers minified files and long lines within a range', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'minified.js'), 'x'.repeat(25000));
  for (const extra of [{}, { view_range: [1, 1] }]) assert.ok(denied(evaluate(native(root, { path: 'minified.js', ...extra }))));
});

test('line threshold counts a final line without a newline', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'edge'), 'x\n'.repeat(349) + 'x');
  assert.deepEqual(evaluate(native(root, { path: 'edge' })), {});
  fs.appendFileSync(path.join(root, 'edge'), '\nx');
  assert.ok(denied(evaluate(native(root, { path: 'edge' }))));
});

test('simple shell reads handle quoting, flags, multiple files and PowerShell aliases', t => {
  const root = fixture(t);
  for (const command of ['cat "large file.txt"', "head -n 10 'large file.txt'", 'cat small.txt "large file.txt"',
    'Get-Content -LiteralPath "large file.txt"', 'tail --lines 5 "large file.txt"']) {
    assert.ok(denied(evaluate(native(root, { command }, 'bash'))), command);
  }
});

test('shell scope is explicit: pipelines, compound commands, writers and unrelated tools pass', t => {
  const root = fixture(t);
  for (const command of ['cat "large file.txt" | grep retry', 'cat "large file.txt" > result',
    'cd . && cat "large file.txt"', 'node /plugin/scripts/bulk-read.mjs --paths "large file.txt"']) {
    assert.deepEqual(evaluate(native(root, { command }, 'bash')), {});
  }
  assert.deepEqual(evaluate(native(root, { path: 'large file.txt' }, 'create')), {});
});

test('hook process emits a denial for malformed input', () => {
  const result = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts/hook.mjs')], { input: 'bad json', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.ok(denied(JSON.parse(result.stdout)));
});

test('source helper rejects missing files, directories, symlink escape, binary and oversized corpus', t => {
  const root = fixture(t);
  const outside = fixture(t);
  fs.symlinkSync(path.join(outside, 'small.txt'), path.join(root, 'escape'));
  fs.writeFileSync(path.join(root, 'binary'), '\0');
  for (const files of [['missing'], ['.'], ['escape'], ['binary'], ['large file.txt']]) {
    assert.throws(() => readSources(files, root, 100));
  }
});

const transcript = (content = 'A concise answer.', model = config().model, extra = []) => [
  { type: 'user.message', data: { content: 'SOURCE_SENTINEL' } },
  { type: 'model.call_start', data: { model } },
  ...extra,
  { type: 'assistant.message', data: { model, phase: 'final_answer', content, toolRequests: [] } },
  { type: 'result', exitCode: 0 },
].map(e => JSON.stringify(e)).join('\n');

test('transport returns only final content; never raw events, source or reasoning', () => {
  assert.equal(parseTranscript(transcript(), config().model, 100), 'A concise answer.');
});

test('transport rejects model substitution, tool use, errors, incomplete and oversized responses', () => {
  for (const value of [transcript('text', 'other-model'), transcript('text', undefined, [{ type: 'tool.execution_start' }]),
    transcript('text', undefined, [{ type: 'session.error' }]), 'SOURCE_SENTINEL', transcript('x'.repeat(101)),
    transcript().replace('"exitCode":0', '"exitCode":1'), transcript().replace('"phase":"final_answer",', '')]) {
    assert.throws(() => parseTranscript(value, config().model, 100), error => !error.message.includes('SOURCE_SENTINEL'));
  }
});

function fakeWorker(root) {
  const file = path.join(root, 'fake copilot');
  fs.writeFileSync(file, `#!/usr/bin/env node
import fs from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
fs.writeFileSync(process.env.SHUNT_TEST_TRACE, JSON.stringify({ input, args: process.argv.slice(2), cwd: process.cwd() }));
const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1];
if (process.env.SHUNT_TEST_FAIL) { console.error(input); process.exit(1); }
if (process.env.SHUNT_TEST_RACE) fs.writeFileSync(process.env.SHUNT_TEST_RACE, 'racing writer');
const content = process.env.SHUNT_TEST_ANSWER || 'A bounded summary.';
console.log(JSON.stringify({ type: 'user.message', data: { content: input } }));
console.log(JSON.stringify({ type: 'assistant.message', data: { model, phase: 'final_answer', content, toolRequests: [] } }));
console.log(JSON.stringify({ type: 'result', exitCode: 0 }));
`, { mode: 0o700 });
  return file;
}

function runHelper(root, helper, args, env = {}) {
  return spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', helper), '--root', root, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, SHUNT_COPILOT_BIN: fakeWorker(root), SHUNT_TEST_TRACE: path.join(root, 'trace.json'), ...env },
  });
}

test('bulk helper sends corpus through stdin in isolated cwd, then returns only summary', t => {
  const root = fixture(t);
  const result = runHelper(root, 'bulk-read.mjs', ['--question', 'Find the behavior', '--paths', 'large file.txt']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'A bounded summary.');
  const trace = JSON.parse(fs.readFileSync(path.join(root, 'trace.json')));
  assert.match(trace.input, /SOURCE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(trace.args), /SOURCE_SENTINEL/);
  assert.notEqual(trace.cwd, root);
  assert.equal(fs.existsSync(trace.cwd), false);
  assert.ok(trace.args.includes('--available-tools'));
  assert.ok(trace.args.includes('--excluded-tools=skill,sql'));
  assert.ok(!trace.args.includes('--allow-all-tools'));
});

test('worker failures do not leak echoed source on stdout or stderr', t => {
  const root = fixture(t);
  const result = runHelper(root, 'bulk-read.mjs', ['--question', 'q', '--paths', 'large file.txt'], { SHUNT_TEST_FAIL: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /SOURCE_SENTINEL/);
});

test('writer publishes code with metadata only and preserves embedded fences', t => {
  const root = fixture(t);
  const code = '# Example\n\n```js\nconst x = 1;\n```\n';
  const result = runHelper(root, 'code-write.mjs', ['--spec', 'Generate documentation', '--reference', 'small.txt', '--target', 'new.md'], { SHUNT_TEST_ANSWER: '```markdown\n' + code + '```' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'new.md'), 'utf8'), code);
  assert.equal(JSON.parse(result.stdout).reviewRequired, true);
  assert.doesNotMatch(result.stdout, /const x/);
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.shunt-')), false);
});

test('writer requires a target and refuses existing targets before calling worker', t => {
  const root = fixture(t);
  for (const args of [[], ['--target', 'small.txt']]) {
    const result = runHelper(root, 'code-write.mjs', ['--spec', 's', '--reference', 'small.txt', ...args]);
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(path.join(root, 'trace.json')), false);
  }
  assert.equal(fs.readFileSync(path.join(root, 'small.txt'), 'utf8'), 'small\n');
});

test('writer refuses a racing target without overwriting it', t => {
  const root = fixture(t);
  const target = path.join(root, 'raced.txt');
  const result = runHelper(root, 'code-write.mjs', ['--spec', 's', '--reference', 'small.txt', '--target', 'raced.txt'], { SHUNT_TEST_RACE: target });
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(target, 'utf8'), 'racing writer');
});

test('worker launch failure and input budget fail without returning source', async t => {
  fixture(t);
  await assert.rejects(invokeWorker('SOURCE_SENTINEL', { ...config(), maxInputBytes: 1 }, 100), /maxInputBytes/);
  await assert.rejects(invokeWorker('SOURCE_SENTINEL', config(), 100, { executable: '/nonexistent/copilot' }), /Could not launch/);
});

test('worker deadline terminates the subprocess and removes its temporary working directory', async t => {
  const root = fixture(t);
  const script = path.join(root, 'slow-copilot');
  const trace = path.join(root, 'slow-cwd');
  fs.writeFileSync(script, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(trace)}, process.cwd());\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
  await assert.rejects(invokeWorker('test', { ...config(), workerTimeoutMs: 500 }, 100, { executable: script }), /timed out/);
  const workerCwd = fs.readFileSync(trace, 'utf8');
  assert.equal(fs.existsSync(workerCwd), false);
});

test('writer rejects a target under a symlink pointing outside the project', t => {
  const root = fixture(t);
  const outside = fixture(t);
  fs.symlinkSync(outside, path.join(root, 'outside'));
  const result = runHelper(root, 'code-write.mjs', ['--spec', 's', '--reference', 'small.txt', '--target', 'outside/new.txt']);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(outside, 'new.txt')), false);
  assert.equal(fs.existsSync(path.join(root, 'trace.json')), false);
});

test('plugin, marketplace and skills resolve to one self-contained package', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json')));
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, manifest.hooks)));
  const hook = hooks.hooks.PreToolUse[0];
  assert.match(hook.command, /\$\{PLUGIN_ROOT\}\/scripts\/hook.mjs/);
  const market = JSON.parse(fs.readFileSync(path.join(pluginRoot, '../.github/plugin/marketplace.json')));
  assert.equal(path.resolve(pluginRoot, '..', market.plugins[0].source), pluginRoot);
  for (const skill of ['shunt-bulk-reader', 'shunt-code-writer']) {
    assert.ok(fs.existsSync(path.join(pluginRoot, 'skills', skill, 'SKILL.md')));
  }
  assert.equal(fs.existsSync(path.join(pluginRoot, 'agents')), false);
});
