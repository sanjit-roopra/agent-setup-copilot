import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildXl, gradeXl, carrierParams, engineSource, probesFor, RULE_IDS } from './generate.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-validate-'));
let ok = true;
const expect = (label, condition, detail = '') => { if (!condition) ok = false; console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition ? '' : ` -> ${detail}`}`); };

const dest = path.join(root, 'project');
const { params, planted } = await buildXl(dest);
const size = spawnSync('sh', ['-c', `cat ${dest}/carriers/*/SPEC.md ${dest}/carriers/*/engine.mjs | wc -c`], { encoding: 'utf8' }).stdout.trim();
console.log(`carriers ${params.length}, planted ${planted.length}, spec+engine bytes ${size}`);

const scratch = fs.mkdtempSync(path.join(root, 'scratch-'));
let thin = [];
for (const p of params) { const { probes } = await probesFor(p, scratch); for (const rule of RULE_IDS) if (probes[rule].length < 2) thin.push(`${p.name}:${rule}=${probes[rule].length}`); }
expect('every (carrier, rule) has at least 2 isolating probes', thin.length === 0, thin.join(' '));

const visible = spawnSync('sh', ['-c', 'node --test carriers/*/tests/*.test.mjs'], { cwd: dest, encoding: 'utf8' });
expect('visible tests are green on the broken project', visible.status === 0, visible.stdout.slice(-400));

let grade = await gradeXl(dest);
expect('broken project scores 0 with no regressions', grade.score === 0 && grade.regressions.length === 0, JSON.stringify(grade).slice(0, 400));

for (const p of params) fs.writeFileSync(path.join(dest, 'carriers', p.name, 'engine.mjs'), engineSource(p));
grade = await gradeXl(dest);
expect('oracle engines score full marks and are accepted', grade.passed && grade.score === planted.length, JSON.stringify(grade).slice(0, 400));
process.exit(ok ? 0 : 1);
