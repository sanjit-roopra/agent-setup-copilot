// Install only fleet-owned files; preserve all unrelated project configuration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function usage() {
  console.error('Usage: node scripts/install.mjs --host vscode|cli --dest /path/to/repo [--force]');
  process.exit(1);
}
const options = new Map();
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (!['--host', '--dest', '--force'].includes(flag) || options.has(flag)) usage();
  const value = flag === '--force' ? true : args[++i];
  if (!value || (typeof value === 'string' && value.startsWith('--'))) usage();
  options.set(flag, value);
}
if (!['vscode', 'cli'].includes(options.get('--host')) || !options.has('--dest')) usage();
const host = options.get('--host');
const dest = path.resolve(options.get('--dest'));
const force = options.has('--force');
const policy = JSON.parse(fs.readFileSync(path.join(source, '.github/fleet/policy.json'), 'utf8'));
const files = new Map();
for (const file of fs.readdirSync(path.join(source, '.github/agents'))) {
  if (!file.endsWith('.agent.md')) continue;
  let text = fs.readFileSync(path.join(source, '.github/agents', file), 'utf8');
  if (host === 'cli') {
    const id = file.slice(0, -'.agent.md'.length);
    const model = id === 'subagent-fleet' ? 'gpt-5.6-sol' : policy.agents[id]?.cliModel;
    if (!model) throw new Error(`Missing model mapping: ${id}`);
    text = text.replace(/^model: .*$/m, `model: "${model}"\nmodelPolicy: required`);
    // CLI agent-frontmatter hooks are not part of the verified CLI contract.
    text = text.replace(/^hooks:\n(?:[ \t].*\n)*/m, '');
  }
  files.set(`.github/agents/${file}`, text);
}
for (const file of ['guard.mjs', 'policy.json', 'review-packet.mjs']) {
  files.set(`.github/fleet/${file}`, fs.readFileSync(path.join(source, '.github/fleet', file), 'utf8'));
}
const hooks = host === 'cli' ? {
  version: 1, hooks: {preToolUse: [{type: 'command', command: 'node .github/fleet/guard.mjs dispatch', cwd: '.', timeoutSec: 10}]}
} : JSON.parse(fs.readFileSync(path.join(source, '.github/hooks/fleet-routing.json'), 'utf8'));
files.set('.github/hooks/fleet-routing.json', JSON.stringify(hooks, null, 2) + '\n');
// Preflight every destination before writing anything. Never follow target symlinks.
for (const [name, text] of files) {
  const target = path.join(dest, name);
  let current = target;
  while (true) {
    if (fs.lstatSync(current, {throwIfNoEntry: false})?.isSymbolicLink()) throw new Error(`Symlink destination refused: ${current}`);
    // Ancestors of the requested root may be OS aliases, such as macOS /var.
    if (current === dest) break;
    current = path.dirname(current);
  }
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== text && !force) {
    console.error(`Refusing to overwrite ${name}. Review changes first, then repeat with --force to replace fleet-owned files.`);
    process.exit(1);
  }
}
for (const [name, text] of files) {
  const target = path.join(dest, name);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, text);
}
console.log(`Installed ${files.size} fleet files for ${host}. No project instructions or editor settings were changed.`);
console.log('Add .fleet-review-*/ to the destination .gitignore before creating review packets.');
console.log(host === 'vscode'
  ? 'Enable chat.useCustomAgentHooks in VS Code and run the smoke checks in docs/STRICT-ROUTING.md.'
  : 'CLI has required model pins and dispatch guards. Scoped read guards are VS Code-only. Do not use Auto. Verify resolved models before deployment.');
