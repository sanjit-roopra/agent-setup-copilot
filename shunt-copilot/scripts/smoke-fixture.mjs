import fs from 'node:fs';
import path from 'node:path';
import { mainError, parseArgs, required } from './common.mjs';

try {
  const args = parseArgs(process.argv.slice(2), ['--dest']);
  const dest = path.resolve(required(args, '--dest'));
  fs.mkdirSync(dest); // Deliberately refuse reuse of an existing fixture directory.
  fs.writeFileSync(path.join(dest, 'large.txt'), Array.from({ length: 400 }, (_, i) =>
    i === 199 ? 'RETRY_LIMIT=7' : `Example data line ${i + 1}`).join('\n') + '\n');
  fs.writeFileSync(path.join(dest, 'reference.mjs'), 'export const example = value => value + 1;\n');
  console.log(`Created synthetic fixture at ${dest}. large.txt has RETRY_LIMIT=7 at line 200.`);
} catch (error) { mainError(error); }
