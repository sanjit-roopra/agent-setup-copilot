import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function config() {
  const value = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'config.json'), 'utf8'));
  value.model = process.env.SHUNT_COPILOT_MODEL || value.model;
  if (!/^[a-z0-9][a-z0-9.-]+$/.test(value.model) || value.model === 'auto') {
    throw new Error('Set SHUNT_COPILOT_MODEL to an explicit Copilot model ID, not auto.');
  }
  // Same role as upstream SHUNT_MIN_LINES, including its fallback when the value is not a positive integer.
  if (/^[1-9]\d*$/.test(process.env.SHUNT_COPILOT_MIN_LINES ?? '')) value.maxReadLines = Number(process.env.SHUNT_COPILOT_MIN_LINES);
  for (const key of ['maxReadLines', 'maxReadBytes', 'maxInputBytes', 'maxSummaryBytes', 'maxCodeBytes', 'workerTimeoutMs']) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0) throw new Error(`Invalid config: ${key}`);
  }
  return value;
}

export function isInside(root, file) {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function readSources(paths, root, maxBytes) {
  const base = fs.realpathSync(root);
  let total = 0;
  return paths.map(file => {
    const resolved = fs.realpathSync(path.resolve(base, file));
    if (!isInside(base, resolved)) throw new Error('Source paths must remain inside --root (including symlinks).');
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('Every source must be a regular file.');
    total += stat.size;
    if (total > maxBytes) throw new Error('Source corpus exceeds maxInputBytes; split the request.');
    const content = fs.readFileSync(resolved, 'utf8');
    if (content.includes('\0')) throw new Error('Only text sources are supported.');
    return { path: path.relative(base, resolved), content };
  });
}

export function parseArgs(argv, names) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!names.includes(name) || result[name] !== undefined) throw new Error(`Unknown or repeated option: ${name}`);
    if (name === '--paths') {
      result[name] = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) result[name].push(argv[++i]);
      if (!result[name].length) throw new Error('--paths needs at least one file.');
    } else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${name} needs a value.`);
      result[name] = argv[++i];
    }
  }
  return result;
}

export function required(args, name) {
  if (!args[name]?.length) throw new Error(`${name} is required.`);
  return args[name];
}

export function mainError(error) {
  // Never dump a worker transcript, which can contain the entire source corpus.
  console.error(`[shunt-copilot] ${error.message}`);
  process.exitCode = 1;
}
