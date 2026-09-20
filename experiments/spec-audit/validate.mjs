// Proves the grader before any credit is spent: the reference scores 7/7, the
// broken project scores 0/7 with green visible tests, and every mutation is
// caught by exactly its own held-out file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSpecAudit, gradeSpecAudit, MUTATIONS } from './fixture.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spec-audit-'));
let ok = true;
const expect = (label, condition, detail) => { if (!condition) ok = false; console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition ? '' : ` -> ${detail}`}`); };

let dir = tmp(); buildSpecAudit(dir, []);
let grade = gradeSpecAudit(dir);
expect('reference scores 7/7 and is accepted', grade.passed && grade.score === 7, JSON.stringify(grade));

dir = tmp(); buildSpecAudit(dir);
grade = gradeSpecAudit(dir);
expect('broken project: visible green, 0/7, regression green', grade.visible && grade.score === 0 && grade.regression && !grade.passed, JSON.stringify(grade));

for (const mutation of MUTATIONS) {
  dir = tmp(); buildSpecAudit(dir, [mutation.id]);
  grade = gradeSpecAudit(dir);
  expect(`${mutation.id} alone: visible green, only its own file fails`, grade.visible && grade.regression && grade.missed.length === 1 && grade.missed[0] === mutation.id, JSON.stringify(grade));
}
process.exit(ok ? 0 : 1);
