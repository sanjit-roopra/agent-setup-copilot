// Run through Fleet Task. Produces an exact diff on disk; stdout contains metadata only.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const [mode, ref, ...extra] = split === -1 ? argv : argv.slice(0, split);
const paths = split === -1 ? [] : argv.slice(split + 1);
const needsRef = ['base', 'merge-base'].includes(mode);
if (!['working', 'staged', 'base', 'merge-base'].includes(mode) || extra.length ||
    (needsRef ? !ref || ref.startsWith('-') : ref !== undefined) ||
    (split !== -1 && !paths.length) || paths.some(p => !p)) {
  console.error('Usage: node .github/fleet/review-packet.mjs working|staged|base <ref>|merge-base <ref> [-- path...]');
  process.exit(1);
}
const fail = message => { console.error(message); process.exit(1); };
const git = (...args) => spawnSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
let from;
if (needsRef) {
  const resolved = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
  if (resolved.status !== 0) fail('Comparison ref is unavailable.');
  from = resolved.stdout.trim();
}
if (mode === 'merge-base') {
  // A shallow history can yield no base, or a wrong one at the graft boundary.
  if (git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') {
    fail('Shallow clone: fetch full history (git fetch --unshallow) before a merge-base packet.');
  }
  const merged = git('merge-base', from, 'HEAD');
  if (merged.status !== 0 || !merged.stdout.trim()) fail('No merge base with HEAD (unborn HEAD or unrelated history).');
  from = merged.stdout.trim().split('\n')[0];
}
// Pathspecs are literal: no glob or magic interpretation of supplied paths.
const result = git('--no-pager', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3',
  ...(mode === 'staged' ? ['--cached'] : []), ...(from ? [from] : []), '--', ...paths);
if (result.status !== 0 || result.error) fail('Could not capture the full diff. Split the change set by path and retry explicitly.');
const dir = fs.mkdtempSync(path.join(root, '.fleet-review-'));
fs.writeFileSync(path.join(dir, 'changes.diff'), result.stdout, {mode: 0o600});
// Metadata only: resolved SHAs and counts, never the supplied ref, paths or source text.
console.log(JSON.stringify({file: path.relative(root, path.join(dir, 'changes.diff')),
  bytes: Buffer.byteLength(result.stdout), lines: result.stdout.split('\n').length - 1,
  comparison: from ? `${mode} ${from.slice(0, 12)} against working tree` : mode,
  pathspecs: paths.length,
  note: 'Exact tracked-file diff. Untracked files are not included. Reviewer must read the entire assigned diff.'}));
