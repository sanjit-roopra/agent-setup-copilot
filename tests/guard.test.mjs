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
fs.writeFileSync(path.join(dir, 'large.txt'), Array.from({length: 800}, (_, i) => `line ${i + 1}\n`).join(''));
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
    {offset: 1}, {offset: 1, limit: 501}, {view_range: [1, -1]},
    {startLine: 1, endLine: 501}, {startLine: 10, endLine: 2}, {startLine: 1, endLine: 800},
    {startLine: 1, endLine: 99999}, {offset: 1, limit: 799},
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
  for (const tool of ['bash', 'Bash', 'powershell', 'run_in_terminal', 'get_changed_files', 'semantic_search', 'search_subagent',
    'explore_subagent', 'github_text_search', 'skill', 'mcp_read', 'task', 'read/terminalLastCommand']) {
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
    assert.ok(check('runSubagent', {agentName}, 'coordinator'));
  }
  assert.ok(check('runSubagent', {}, 'coordinator'));
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
    assert.ok(!profile.includes('search/'));
  }
  assert.ok(fs.readFileSync(path.join(dest, '.github/agents/fleet-code-review.agent.md'), 'utf8').includes('tools: ["read", "search"]'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, '.github/fleet/policy.json'))).dispatchUnknown, 'deny');
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
    const tools = JSON.parse(p.match(/^tools: (.*)$/m)[1]);
    assert.ok(!tools.some(t => ['execute', 'search', 'agent', 'search/changes', 'search/codebase', 'search/searchSubagent'].includes(t)));
    assert.equal(tools.some(t => t.startsWith('search/')), id !== 'fleet-rubber-duck');
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
  fs.writeFileSync(path.join(dir, 'endpoint.txt'), 'short\n' + 'x'.repeat(50000) + '\nshort\n');
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
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, '.github/fleet/policy.json'))).dispatchUnknown, 'pass');
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

test('ranges up to the ceiling pass, including limit equal to the ceiling and spans clamped at EOF', () => {
  const max = policy.limits.excerptLines;
  for (const range of [{startLine: 1, endLine: max}, {offset: 1, limit: max}, {view_range: [301, 800]}, {offset: 700, limit: max}]) {
    assert.equal(check('read_file', {filePath: 'large.txt', ...range}), null);
  }
  assert.equal(check('read_file', {filePath: 'small.txt', startLine: 1, endLine: 99999}), null);
});

test('a range that spans a large file is a whole-file read and points at Fleet Explore', () => {
  fs.writeFileSync(path.join(dir, 'mid.txt'), 'line\n'.repeat(400));
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'line\n'.repeat(300));
  assert.match(check('read_file', {filePath: 'mid.txt', startLine: 1, endLine: 400}), /Fleet Explore/);
  assert.match(check('read_file', {filePath: 'mid.txt'}), /Fleet Explore/);
  assert.equal(check('read_file', {filePath: 'mid.txt', startLine: 1, endLine: 399}), null);
  assert.equal(check('read_file', {filePath: 'ok.txt', startLine: 1, endLine: 300}), null);
});

test('review packets are read whole up to the packet limit; lookalike paths are not packets', () => {
  const big = 'line of diff text\n'.repeat(3000);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true});
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write('.fleet-review-abc/changes.diff', big);
  assert.ok(Buffer.byteLength(big) > policy.limits.fullReadBytes && Buffer.byteLength(big) <= policy.limits.packetBytes);
  assert.equal(check('read_file', {filePath: '.fleet-review-abc/changes.diff'}), null);
  assert.equal(check('read_file', {filePath: '.fleet-review-abc/changes.diff', startLine: 1, endLine: 3000}), null);
  write('.fleet-review-big/changes.diff', 'x'.repeat(100) .concat('\n').repeat(2000));
  assert.match(check('read_file', {filePath: '.fleet-review-big/changes.diff', startLine: 1, endLine: 2000}), /path-scoped/);
  assert.equal(check('read_file', {filePath: '.fleet-review-big/changes.diff', startLine: 1, endLine: 500}), null);
  for (const rel of ['.fleet-review-abc/sub/changes.diff', '.fleet-review-abc/changes.diff.bak', 'x/.fleet-review-y/changes.diff']) {
    write(rel, big);
    assert.ok(check('read_file', {filePath: rel}), rel);
  }
  write('source.txt', big);
  fs.mkdirSync(path.join(dir, '.fleet-review-link'));
  fs.symlinkSync(path.join(dir, 'source.txt'), path.join(dir, '.fleet-review-link/changes.diff'));
  assert.ok(check('read_file', {filePath: '.fleet-review-link/changes.diff'}));
  write('.fleet-review-bin/changes.diff', Buffer.from([1, 0, 2]));
  assert.ok(check('read_file', {filePath: '.fleet-review-bin/changes.diff'}));
});

test('bounded search tools pass for reviewers with capped results and contained paths', () => {
  assert.equal(check('grep_search', {query: 'foo', isRegexp: false}), null);
  assert.equal(check('grep_search', {query: 'foo', maxResults: policy.limits.searchMaxResults, includeIgnoredFiles: false}), null);
  assert.equal(check('file_search', {query: '**/*.ts'}), null);
  assert.equal(check('vscode_listCodeUsages', {symbol: 'foo'}), null);
  assert.equal(check('list_dir', {path: '.'}), null);
  for (const maxResults of [0, 1.5, '50', -1, policy.limits.searchMaxResults + 1, null]) {
    assert.ok(check('grep_search', {query: 'foo', maxResults}));
  }
  assert.ok(check('grep_search', {query: 'foo', includeIgnoredFiles: true}));
  assert.ok(check('list_dir', {path: path.dirname(root)}));
  assert.ok(check('list_dir', {}));
  assert.ok(check('grep_search', {query: 'foo'}, 'coordinator'));
});

test('workspace dispatch hook ignores non-fleet delegation but not near misses', () => {
  for (const args of [{}, {prompt: 'hi'}, {agentName: 'general-purpose'}, {agentName: 'My Other Agent', model: 'GPT-6 Astra (copilot)'}]) {
    assert.equal(check('runSubagent', args, 'dispatch'), null);
  }
  for (const agentName of ['plugin:fleet-code-review', 'Fleet Code Review (workspace)', '@Fleet Explore', 'Subagent Fleet', 'subagent-fleet', '', null, 7]) {
    assert.ok(check('runSubagent', {agentName, model: 'GPT-6 Astra (copilot)'}, 'dispatch'), String(agentName));
  }
  const strict = {...policy, dispatchUnknown: 'deny'};
  for (const args of [{}, {agentName: 'general-purpose'}]) {
    assert.ok(evaluate(event('runSubagent', args), 'dispatch', strict, dir));
  }
  assert.equal(evaluate(event('runSubagent', {agentName: 'Fleet Explore'}), 'dispatch', strict, dir), null);
});

test('guard-authored messages reach the model without echoing supplied values', () => {
  assert.match(check('read_file', {filePath: 'large.txt', offset: 5}), /Offset alone is not bounded/);
  assert.match(check('runSubagent', {prompt: 'hi'}, 'coordinator'), /Expected exactly one of agentName/);
  assert.match(check('read_file', {filePath: 'small.txt', path: 'large.txt'}), /Expected exactly one of filePath/);
  const secret = 'secret-value-4711';
  for (const reason of [
    check('read_file', {filePath: `${secret}.txt`}),
    check('read_file', {filePath: `../${secret}`}),
    check('runSubagent', {agentName: 'Fleet Explore', [`${secret}Model`]: 'x'}, 'dispatch'),
    check('runSubagent', {agentName: secret}, 'coordinator'),
    evaluate({tool_name: 'read_file', tool_input: `{"filePath": "${secret}`}, 'bounded-reader', policy, dir)
  ]) {
    assert.ok(reason);
    assert.ok(!reason.includes(secret));
  }
  assert.match(check('read_file', {filePath: 'missing'}), /could not validate this call \(ENOENT\)/);
});

test('every profile model pin matches policy.json and every fleet profile has a policy entry', () => {
  const agentsDir = path.join(root, '.github/agents');
  const pin = id => fs.readFileSync(path.join(agentsDir, `${id}.agent.md`), 'utf8').match(/^model: "(.*)"$/m)?.[1];
  for (const [id, agent] of Object.entries(policy.agents)) assert.equal(pin(id), agent.model, id);
  const profiles = fs.readdirSync(agentsDir).filter(f => /^fleet-.*\.agent\.md$/.test(f)).map(f => f.slice(0, -'.agent.md'.length));
  assert.deepEqual(profiles.sort(), Object.keys(policy.agents).sort());
  // scripts/install.mjs hard-codes the coordinator's CLI id as gpt-5.6-sol.
  assert.equal(pin('subagent-fleet'), 'GPT-5.6 Sol (copilot)');
});

test('review packet merge-base and path-scoped modes', () => {
  const repo = path.join(dir, 'merge-repo');
  fs.mkdirSync(path.join(repo, '.github/fleet'), {recursive: true});
  fs.copyFileSync(path.join(root, '.github/fleet/review-packet.mjs'), path.join(repo, '.github/fleet/review-packet.mjs'));
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {cwd: repo, encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr); return r.stdout;
  };
  const run = (...args) => spawnSync(process.execPath, ['.github/fleet/review-packet.mjs', ...args], {cwd: repo, encoding: 'utf8'});
  const packet = r => { assert.equal(r.status, 0, r.stderr); const meta = JSON.parse(r.stdout); return [meta, fs.readFileSync(path.join(repo, meta.file), 'utf8')]; };
  git('init', '-b', 'trunk');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  git('add', 'a.txt', 'b.txt'); git('commit', '-m', 'root');
  git('checkout', '-b', 'topic');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'topic_change\n'); git('commit', '-am', 'topic');
  git('checkout', 'trunk');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'trunk_only_change\n'); git('commit', '-am', 'trunk');
  git('checkout', 'topic');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'uncommitted_b\n');

  const [, twoDot] = packet(run('base', 'trunk'));
  assert.ok(twoDot.includes('trunk_only_change'));
  const [meta, merged] = packet(run('merge-base', 'trunk'));
  assert.ok(merged.includes('topic_change') && merged.includes('uncommitted_b') && !merged.includes('trunk_only_change'));
  assert.match(meta.comparison, /^merge-base [0-9a-f]{12} against working tree$/);
  assert.ok(!meta.comparison.includes('trunk') && !JSON.stringify(meta).includes('topic_change'));

  const [scoped, onlyA] = packet(run('merge-base', 'trunk', '--', 'a.txt'));
  assert.equal(scoped.pathspecs, 1);
  assert.ok(onlyA.includes('topic_change') && !onlyA.includes('uncommitted_b'));
  const [, literal] = packet(run('working', '--', '*.txt'));
  assert.equal(literal, '');

  git('checkout', '--detach', 'HEAD');
  assert.equal(run('merge-base', 'trunk').status, 0);
  for (const args of [['merge-base'], ['merge-base', '-x'], ['merge-base', 'missing-ref'], ['working', '--'], ['working', '--', ''], ['merge-base', 'trunk', 'extra']]) {
    assert.notEqual(run(...args).status, 0, args.join(' '));
  }
  git('checkout', '--orphan', 'island'); git('commit', '--allow-empty', '-m', 'island');
  const unrelated = run('merge-base', 'trunk');
  assert.notEqual(unrelated.status, 0);
  assert.match(unrelated.stderr, /No merge base/);
});
