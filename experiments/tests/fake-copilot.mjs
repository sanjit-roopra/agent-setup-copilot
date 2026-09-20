#!/usr/bin/env node
// Stand-in for the Copilot CLI so the ladder can be tested end to end without spending a credit.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const value = name => argv[argv.indexOf(name) + 1];
const dir = value('-C'), model = value('--model'), prompt = value('-p'), mode = process.env.FAKE_MODE;
const write = (file, content) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), content); };
const attempt = path.basename(dir);

if (model === 'strong') {
  fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ attempt, sawOther: fs.existsSync(path.join(dir, '.ladder-other/src/b.mjs')), prompt })}\n`);
  if (attempt === 'strong-solo') for (let i = 0; i < 4; i++) write(`src/f${i}.mjs`, 'strong solo\n');
  else write('src/b.mjs', 'export const b = "settled by strong";\n');
} else if (mode === 'agree') write('src/a.mjs', 'export const a = "fixed";\n');
else if (mode === 'dispute') {
  write('src/a.mjs', 'export const a = "fixed";\n');
  write('src/b.mjs', `export const b = "${attempt}";\n`);
} else if (mode === 'diverge') for (let i = 0; i < 4; i++) write(`src/f${i}.mjs`, `${attempt}\n`);

fs.writeFileSync(value('--usage-output-file'), JSON.stringify({ totalNanoAiu: model === 'strong' ? 9e9 : 1e9, modelMetrics: {} }));
console.log(JSON.stringify({ type: 'assistant.message', data: { phase: 'final_answer', content: `done by ${model}` } }));
