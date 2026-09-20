import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, pluginRoot } from './common.mjs';

const readTools = new Set(['read', 'read_file', 'readFile', 'Read', 'view']);
const shellTools = new Set(['bash', 'Bash', 'powershell', 'run_in_terminal', 'runInTerminal', 'execute_command']);

export function deny(reason) {
  // Native CLI/app use the flat fields; VS Code uses hookSpecificOutput.
  return {
    permissionDecision: 'deny', permissionDecisionReason: reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason,
    },
  };
}

function range(args) {
  if ('view_range' in args) return args.view_range;
  if ('startLine' in args || 'endLine' in args) return [args.startLine, args.endLine];
  if ('offset' in args || 'limit' in args) {
    const start = args.offset ?? 1;
    return [start, Number.isSafeInteger(args.limit) ? start + args.limit - 1 : undefined];
  }
  return null;
}

function boundedRange(bounds, limits) {
  if (Number.isSafeInteger(bounds?.tail)) return bounds.tail >= 1 && bounds.tail <= limits.maxReadLines;
  return Array.isArray(bounds) && bounds.length === 2 && bounds.every(Number.isSafeInteger)
    && bounds[0] >= 1 && bounds[1] >= bounds[0] && bounds[1] - bounds[0] + 1 <= limits.maxReadLines;
}

function exceedsRead(file, bounds, limits) {
  let stat;
  try { stat = fs.statSync(file); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
  if (!stat.isFile()) return false;
  if (bounds && !boundedRange(bounds, limits)) return true;
  if (!bounds && stat.size > limits.maxReadBytes) return true;
  // Bound scanning even for a tiny range near the end of a huge file. No network/model calls in hooks.
  if (stat.size > limits.maxInputBytes) return true;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const selected = !bounds ? lines : bounds.tail ? lines.slice(-bounds.tail) : lines.slice(bounds[0] - 1, bounds[1]);
  return selected.length > limits.maxReadLines || Buffer.byteLength(selected.join('\n')) > limits.maxReadBytes;
}

// Intentionally limited to simple read commands. This is a context-cost guard, not a shell sandbox.
// Returns the files a command reads and, for an explicit head/tail style count, the lines it asks for.
export function shellRead(command) {
  const none = { files: [], count: null, fromEnd: false };
  if (typeof command !== 'string' || /[|;&<>`$\n\r]/.test(command)) return none;
  const tokens = command.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g)?.map(t => t.replace(/^(['"])(.*)\1$/, '$2')) ?? [];
  const name = path.basename(tokens.shift() ?? '').toLowerCase();
  if (!['cat', 'head', 'tail', 'less', 'more', 'get-content', 'gc', 'type'].includes(name)) return none;
  // Which flags consume the next token depends on the command: `head -n 5 f` but `cat -n f`.
  const headTail = name === 'head' || name === 'tail';
  const powershell = name === 'get-content' || name === 'gc';
  const lineFlag = headTail ? /^(-n|--lines)$/ : powershell ? /^-(totalcount|head|first|tail|last)$/i : null;
  const valueFlag = headTail ? /^(-c|--bytes)$/ : powershell ? /^-(encoding|readcount|delimiter)$/i : null;
  const files = [];
  let literal = false, count = null, fromEnd = name === 'tail';
  // Only a plain positive count is a bounded read; `tail -n +5` and `head -n -5` run to a file edge.
  const setCount = value => { count = /^\d+$/.test(value ?? '') ? Number(value) : NaN; };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') { literal = true; continue; }
    if (!literal && lineFlag?.test(token)) {
      if (powershell) fromEnd = /^-(tail|last)$/i.test(token);
      setCount(tokens[++i]);
      continue;
    }
    if (!literal && valueFlag?.test(token)) { i++; continue; }
    const attached = !literal && headTail && token.match(/^(?:-n|--lines=|-(?=\d))(.+)$/);
    if (attached) { setCount(attached[1]); continue; }
    if (!literal && token.startsWith('-')) continue;
    files.push(token);
  }
  return { files, count, fromEnd };
}

export const shellPaths = command => shellRead(command).files;

function shellBounds({ files, count, fromEnd }) {
  if (count === null) return null;
  // Every file contributes `count` lines to the same tool result.
  const total = count * files.length;
  return fromEnd ? { tail: total } : [1, total];
}

export function evaluate(input, limits = config()) {
  const tool = input.tool_name ?? input.toolName;
  let args = input.tool_input ?? input.toolArgs ?? {};
  if (typeof args === 'string') args = JSON.parse(args);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
  const cwd = input.cwd || process.cwd();
  let blocked = false;
  if (readTools.has(tool)) {
    const file = args.file_path ?? args.filePath ?? args.path;
    if (typeof file === 'string' && file) blocked = exceedsRead(path.resolve(cwd, file), range(args), limits);
  } else if (shellTools.has(tool)) {
    const read = shellRead(args.command);
    blocked = read.files.some(file => exceedsRead(path.resolve(cwd, file), shellBounds(read), limits));
  }
  if (!blocked) return {};
  return deny(`SHUNT_COPILOT_READ_REDIRECT: This read exceeds the ${limits.maxReadLines}-line / ${limits.maxReadBytes}-byte budget. Use the shunt-bulk-reader skill: run node with script ${JSON.stringify(path.join(pluginRoot, 'scripts/bulk-read.mjs'))}, --root set to the project root, --question with the specific question, and --paths with the source paths. The helper reads the files and returns only a cheap-model summary. Do not chunk through the whole file to bypass this guard. For exact edits, request a small explicit line range. Files above ${limits.maxInputBytes} bytes must be split or inspected with a targeted shell query.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(evaluate(JSON.parse(fs.readFileSync(0, 'utf8'))))); }
  catch { console.log(JSON.stringify(deny('SHUNT_COPILOT_HOOK_ERROR: Could not validate this read. Check the hook configuration and input; no source was returned.'))); }
}
