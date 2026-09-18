// Run through Fleet Task. Produces an exact diff on disk; stdout contains metadata only.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [mode, base] = process.argv.slice(2);
if (!['working', 'staged', 'base'].includes(mode) ||
    (mode === 'base' ? !base || base.startsWith('-') : base !== undefined) || process.argv.length > 4) {
  console.error('Usage: node .github/fleet/review-packet.mjs working|staged|base [explicit-ref]');
  process.exit(1);
}
let refs = [];
if (mode === 'base') {
  const resolved = spawnSync('git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], {cwd: root, encoding: 'utf8'});
  if (resolved.status !== 0) { console.error('Comparison ref is unavailable.'); process.exit(1); }
  refs = [resolved.stdout.trim()];
}
const args = ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3',
  ...(mode === 'staged' ? ['--cached'] : []), ...refs, '--'];
const result = spawnSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
if (result.status !== 0 || result.error) {
  console.error('Could not capture the full diff. Split the change set and retry explicitly.');
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(root, '.fleet-review-'));
fs.writeFileSync(path.join(dir, 'changes.diff'), result.stdout, {mode: 0o600});
console.log(JSON.stringify({file: path.relative(root, path.join(dir, 'changes.diff')),
  bytes: Buffer.byteLength(result.stdout), lines: result.stdout.split('\n').length - 1,
  comparison: mode === 'base' ? `${base} against working tree` : mode,
  note: 'Exact tracked-file diff. Untracked files are not included. Reviewer must inspect the entire assigned diff in bounded excerpts.'}));
