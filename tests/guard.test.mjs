import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluate, response, policy, root } from '../.github/fleet/guard.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-guard-'));
const event = (tool, input) => ({tool_name: tool, tool_input: input, cwd: dir});
const check = (tool, input, role = 'bounded-reader') => evaluate(event(tool, input), role, policy, dir);
fs.writeFileSync(path.join(dir, 'large.txt'), Array.from({length: 500}, (_, i) => `line ${i + 1}\n`).join(''));
fs.writeFileSync(path.join(dir, 'small.txt'), 'small\nfile\n');
fs.writeFileSync(path.join(dir, 'long.txt'), 'x'.repeat(30000));
fs.writeFileSync(path.join(dir, 'binary'), Buffer.from([0, 1, 2]));
test.after(() => fs.rmSync(dir, {recursive: true, force: true}));

test('small reads pass without auto-approving host permissions', () => {
  assert.equal(check('read_file', {filePath: 'small.txt'}), null);
  assert.deepEqual(response(null), {});
});
test('large full-file reads are blocked in every supported read adapter', () => {
  for (const [tool, args] of [['read_file', {filePath: 'large.txt'}], ['Read', {file_path: 'large.txt'}], ['view', {path: 'large.txt'}]]) {
    assert.ok(check(tool, args));
  }
});
test('narrow excerpts are allowed on large files', () => {
  for (const [tool, args] of [
    ['read_file', {filePath: 'large.txt', startLine: 200, endLine: 220}],
    ['Read', {file_path: 'large.txt', offset: 200, limit: 20}],
    ['view', {path: 'large.txt', view_range: [200, 220]}]
  ]) assert.equal(check(tool, args), null);
});
test('offset, huge limit, -1, invalid ranges and mixed schemas do not bypass limits', () => {
  for (const range of [
    {offset: 1}, {offset: 1, limit: 500}, {view_range: [1, -1]},
    {startLine: 1, endLine: 500}, {startLine: 10, endLine: 2},
    {startLine: '1', endLine: '20'}, {offset: 0, limit: 20},
    {offset: 1, limit: 20, startLine: 1, endLine: 20}
  ]) assert.ok(check('read_file', {filePath: 'large.txt', ...range}));
});
test('line limits cannot hide a huge minified line', () => {
  assert.ok(check('read_file', {filePath: 'long.txt'}));
  assert.ok(check('read_file', {filePath: 'long.txt', startLine: 1, endLine: 1}));
});
test('bytes, binary files, directories and missing paths fail closed', () => {
  assert.ok(check('read_file', {filePath: 'binary'}));
  assert.ok(check('read_file', {filePath: '.'}));
  assert.ok(check('read_file', {filePath: 'missing'}));
  assert.ok(check('read_file', {filePath: 'small.txt', path: 'large.txt'}));
  const fd = fs.openSync(path.join(dir, 'huge'), 'w');
  fs.ftruncateSync(fd, policy.limits.scanBytes + 1); fs.closeSync(fd);
  assert.ok(check('view', {path: 'huge', view_range: [1, 2]}));
});
test('path traversal and symlinks outside workspace are blocked', () => {
  assert.ok(check('read_file', {filePath: path.join(root, 'README.md')}));
  fs.symlinkSync(path.join(root, 'README.md'), path.join(dir, 'outside'));
  assert.ok(check('read_file', {filePath: 'outside'}));
});
test('all shell and alternate tools are blocked for premium bounded readers', () => {
  for (const tool of ['bash', 'Bash', 'powershell', 'run_in_terminal', 'grep', 'search/codebase', 'mcp_read', 'task', 'read/terminalLastCommand']) {
    for (const command of ['cat large.txt', 'cat large.txt | grep .', 'python -c "print(open(\"large.txt\").read())"']) {
      assert.ok(check(tool, {command}));
    }
  }
});
test('dispatch guard does not block cheap-worker reads or writes', () => {
  for (const tool of ['Read', 'read_file', 'bash', 'edit']) assert.equal(check(tool, {filePath: 'large.txt'}, 'dispatch'), null);
});
test('coordinator cannot read, execute, search or edit', () => {
  for (const tool of ['Read', 'bash', 'edit', 'search']) assert.ok(check(tool, {}, 'coordinator'));
});
test('only named fleet delegation passes; builtin and recursive agents fail', () => {
  for (const agent of Object.values(policy.agents)) {
    assert.equal(check('runSubagent', {agentName: agent.name, prompt: 'Find the symbol.'}, 'coordinator'), null);
  }
  for (const agentName of ['general-purpose', 'explore', 'Subagent Fleet', '', null]) {
    assert.ok(check('runSubagent', {agentName}, 'dispatch'));
  }
  assert.ok(check('runSubagent', {}, 'dispatch'));
  assert.ok(check('runSubagent', {agentName: 'Fleet Explore', agent: 'Fleet Task'}, 'dispatch'));
});
test('CLI camelCase envelope and JSON-string args are supported', () => {
  assert.equal(evaluate({toolName: 'task', toolArgs: JSON.stringify({agent_type: 'fleet-explore'})}), null);
  assert.equal(response('blocked', true).permissionDecision, 'deny');
  assert.equal(response('blocked').hookSpecificOutput.permissionDecision, 'deny');
});
test('expensive, auto and unknown model overrides are rejected', () => {
  for (const model of ['GPT-6 Astra (copilot)', 'auto', '', null]) {
    assert.ok(check('runSubagent', {agentName: 'Fleet Explore', model}, 'dispatch'));
  }
  assert.equal(check('runSubagent', {agentName: 'Fleet Explore', model: 'GPT-5.6 Luna (copilot)'}, 'dispatch'), null);
  assert.ok(check('runSubagent', {agentName: 'Fleet Explore', modelId: 'gpt-6-astra'}, 'dispatch'));
});
test('delegation cannot carry a whole large file', () => {
  assert.ok(check('runSubagent', {agentName: 'Fleet Explore', prompt: 'x'.repeat(17000)}, 'dispatch'));
});
test('invalid inputs and unknown scoped roles fail closed', () => {
  for (const payload of [null, [], {}, {tool_name: 'Read', tool_input: 'broken'}, {tool_name: 'Read', tool_input: null}]) {
    assert.ok(evaluate(payload));
  }
  assert.ok(evaluate(event('Read', {}), 'typo'));
});
test('real hook process emits only decision JSON on malformed stdin', () => {
  const result = spawnSync(process.execPath, ['.github/fleet/guard.mjs'], {cwd: root, input: 'secret malformed payload', encoding: 'utf8'});
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(!result.stdout.includes('secret'));
});
test('generated CLI install pins models and preserves unrelated files', () => {
  const dest = path.join(dir, 'installed'); fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'AGENTS.md'), 'existing instructions');
  const install = (...args) => spawnSync(process.execPath, ['scripts/install.mjs', '--host', 'cli', '--dest', dest, ...args], {cwd: root, encoding: 'utf8'});
  const installed = install();
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(fs.readFileSync(path.join(dest, 'AGENTS.md'), 'utf8'), 'existing instructions');
  for (const [id, agent] of Object.entries(policy.agents)) {
    const profile = fs.readFileSync(path.join(dest, `.github/agents/${id}.agent.md`), 'utf8');
    assert.ok(profile.includes(`model: "${agent.cliModel}"`));
    assert.ok(profile.includes('modelPolicy: required'));
    assert.ok(!profile.includes('\nhooks:'));
  }
  const hooks = JSON.parse(fs.readFileSync(path.join(dest, '.github/hooks/fleet-routing.json')));
  assert.ok(hooks.hooks.preToolUse);
  const target = path.join(dest, '.github/agents/fleet-task.agent.md');
  fs.writeFileSync(target, 'user modification');
  assert.notEqual(install().status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), 'user modification');
});
test('profile guard wiring excludes cheap workers to avoid read/delegation loops', () => {
  for (const id of ['fleet-explore', 'fleet-task', 'fleet-general-purpose']) {
    const p = fs.readFileSync(path.join(root, `.github/agents/${id}.agent.md`), 'utf8');
    assert.ok(!p.includes('bounded-reader'));
    assert.ok(p.includes(policy.agents[id].model));
  }
  for (const id of ['fleet-code-review', 'fleet-security-review', 'fleet-rubber-duck']) {
    const p = fs.readFileSync(path.join(root, `.github/agents/${id}.agent.md`), 'utf8');
    assert.ok(p.includes('guard.mjs bounded-reader'));
    assert.ok(p.includes('tools: ["read"]'));
  }
});
test('review packet stores exact diff and never sends source to stdout', () => {
  const repo = path.join(dir, 'packet-repo');
  fs.mkdirSync(path.join(repo, '.github/fleet'), {recursive: true});
  fs.copyFileSync(path.join(root, '.github/fleet/review-packet.mjs'), path.join(repo, '.github/fleet/review-packet.mjs'));
  const git = (...args) => {
    const r = spawnSync('git', args, {cwd: repo, encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr); return r.stdout;
  };
  git('init'); fs.writeFileSync(path.join(repo, 'file.txt'), 'before\n');
  git('add', 'file.txt'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'private_source_after\n');
  const run = (...args) => spawnSync(process.execPath, ['.github/fleet/review-packet.mjs', ...args], {cwd: repo, encoding: 'utf8'});
  const r = run('working'); assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('private_source_after'));
  const meta = JSON.parse(r.stdout);
  assert.equal(fs.readFileSync(path.join(repo, meta.file), 'utf8'), git('--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--'));
  assert.notEqual(run('base', '--output=bad').status, 0);
  assert.notEqual(run('base', 'missing-ref').status, 0);
  assert.notEqual(run('working', 'unexpected').status, 0);
});
test('out-of-file ranges and V2 inclusive endpoint cannot hide a large line', () => {
  assert.ok(check('read_file', {filePath: 'long.txt', startLine: 50, endLine: 60}));
  fs.writeFileSync(path.join(dir, 'endpoint.txt'), 'short\n' + 'x'.repeat(20000));
  assert.ok(check('read_file', {filePath: 'endpoint.txt', offset: 1, limit: 1}));
});

test('installer accepts aliased parent paths and force in any position', () => {
  const parent = path.join(dir, 'real-parent');
  const alias = path.join(dir, 'parent-alias');
  fs.mkdirSync(parent);
  fs.symlinkSync(parent, alias, 'dir');
  const dest = path.join(alias, 'project');
  const run = (...args) => spawnSync(process.execPath, ['scripts/install.mjs', ...args], {cwd: root, encoding: 'utf8'});
  for (const args of [
    ['--force', '--host', 'vscode', '--dest', dest],
    ['--host', 'vscode', '--force', '--dest', dest],
    ['--host', 'vscode', '--dest', dest, '--force']
  ]) {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
  }
  const profile = fs.readFileSync(path.join(dest, '.github/agents/fleet-code-review.agent.md'), 'utf8');
  assert.ok(profile.includes('guard.mjs bounded-reader'));
  assert.ok(!profile.includes('modelPolicy: required'));
  const hooks = JSON.parse(fs.readFileSync(path.join(dest, '.github/hooks/fleet-routing.json')));
  assert.ok(hooks.hooks.PreToolUse);
});

test('installer rejects malformed arguments before writing', () => {
  const dest = path.join(dir, 'invalid-install');
  for (const args of [
    ['--host', 'cli', '--dest', dest, '--force', 'unexpected'],
    ['--host', 'cli', '--dest', dest, '--host', 'vscode'],
    ['--host', 'cli', '--dest', dest, '--unknown'],
    ['--host', '--dest', dest],
    ['--host', 'cli', '--dest'],
    ['--host', 'cli', '--dest', dest, '--force', '--force']
  ]) {
    const result = spawnSync(process.execPath, ['scripts/install.mjs', ...args], {cwd: root, encoding: 'utf8'});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
    assert.ok(!fs.existsSync(dest));
  }
});

test('installer preflight rejects existing and dangling target symlinks even with force', () => {
  for (const existing of [false, true]) {
    const dest = path.join(dir, `symlink-install-${existing}`);
    fs.mkdirSync(path.join(dest, '.github/hooks'), {recursive: true});
    const outside = path.join(dir, `outside-hook-${existing}`);
    if (existing) fs.writeFileSync(outside, 'untouched');
    fs.symlinkSync(outside, path.join(dest, '.github/hooks/fleet-routing.json'));
    const result = spawnSync(process.execPath, ['scripts/install.mjs', '--host', 'vscode', '--dest', dest, '--force'], {cwd: root, encoding: 'utf8'});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Symlink destination refused/);
    assert.ok(!fs.existsSync(path.join(dest, '.github/agents')));
    if (existing) assert.equal(fs.readFileSync(outside, 'utf8'), 'untouched');
    else assert.ok(!fs.existsSync(outside));
  }
});
