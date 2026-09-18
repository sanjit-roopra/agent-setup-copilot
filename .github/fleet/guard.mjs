// No network, dependencies, subprocesses, or source-content logging.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const policy = JSON.parse(fs.readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
const delegates = new Set(['task', 'Agent', 'Task', 'runSubagent', 'run_subagent', 'agent/runSubagent']);
const reads = new Set(['read_file', 'readFile', 'read/readFile', 'Read', 'view']);
const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;

function uniqueField(args, names) {
  const values = names.filter(n => Object.hasOwn(args, n)).map(n => args[n]);
  if (values.length !== 1) throw new Error(`Expected exactly one of ${names.join(', ')}.`);
  return values[0];
}

function delegation(args, config) {
  const name = uniqueField(args, ['agentName', 'agent_type', 'subagent_type', 'agent']);
  if (typeof name !== 'string') return 'Delegation requires a named fleet specialist.';
  const agent = Object.entries(config.agents).find(([id, item]) =>
    normalize(name) === normalize(id) || normalize(name) === normalize(item.name))?.[1];
  if (!agent) return 'Use a named Fleet specialist. Built-in and recursive coordinator delegation are disabled.';
  // Reject hidden/ambiguous overrides. Only the documented model field is allowed.
  for (const key of Object.keys(args)) {
    if (/model/i.test(key) && key !== 'model') return `Unsupported model override field: ${key}.`;
  }
  if (Object.hasOwn(args, 'model') && ![agent.model, agent.cliModel].includes(args.model)) {
    return `Use ${agent.name} with its pinned model ${agent.model}; omit the model override.`;
  }
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > config.limits.delegationBytes) {
    return 'Delegation context is too large. Pass paths, task, constraints and acceptance criteria, not whole files or logs.';
  }
  return null;
}

function readBounds(args) {
  const families = [
    ['startLine', 'endLine'], ['offset', 'limit'], ['view_range']
  ].filter(keys => keys.some(key => Object.hasOwn(args, key)));
  if (families.length > 1) throw new Error('Ambiguous range formats.');
  if (!families.length) return null;
  if (families[0][0] === 'startLine') {
    if (!positive(args.startLine) || !positive(args.endLine) || args.endLine < args.startLine) {
      throw new Error('Use positive startLine and endLine for a bounded excerpt.');
    }
    return [args.startLine, args.endLine];
  }
  if (families[0][0] === 'offset') {
    const start = args.offset ?? 1;
    if (!positive(start) || !positive(args.limit) || !Number.isSafeInteger(start + args.limit - 1)) {
      throw new Error('Use a positive offset and finite positive limit. Offset alone is not bounded.');
    }
    // VS Code V2 currently includes the end line at start + limit.
    // Count it conservatively for every offset/limit adapter.
    return [start, start + args.limit];
  }
  if (!Array.isArray(args.view_range) || args.view_range.length !== 2 ||
      !args.view_range.every(positive) || args.view_range[1] < args.view_range[0]) {
    throw new Error('Use a finite positive view_range; -1 is not bounded.');
  }
  return args.view_range;
}

function boundedRead(args, event, config, workspace) {
  const supplied = uniqueField(args, ['filePath', 'file_path', 'path']);
  if (typeof supplied !== 'string' || !supplied || supplied.includes('\0')) return 'Invalid file path.';
  const base = fs.realpathSync(workspace);
  const file = fs.realpathSync(path.resolve(event.cwd || workspace, supplied));
  const relative = path.relative(base, file);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return 'Read outside the repository is blocked, including symlinks.';
  }
  const stat = fs.statSync(file);
  if (!stat.isFile()) return 'Use Fleet Explore to list directories; only regular files can be read here.';
  const range = readBounds(args);
  const limits = config.limits;
  if (range && range[1] - range[0] + 1 > limits.excerptLines) {
    return `Request at most ${limits.excerptLines} lines per excerpt.`;
  }
  if (stat.size > limits.scanBytes) return 'File exceeds inspection limit. Ask Fleet Explore for the relevant source locations.';
  if (!range && stat.size > limits.fullReadBytes) return 'Full-file read is too large. Ask Fleet Explore for locations, then read a bounded excerpt.';
  const data = fs.readFileSync(file);
  if (data.includes(0)) return 'Binary reads are not supported.';
  let line = 1, lines = 0, bytes = 0, start = 0;
  for (let i = 0; i <= data.length; i++) {
    if (i !== data.length && data[i] !== 10) continue;
    if (i === data.length && i === start) break;
    const end = i < data.length ? i + 1 : i;
    if (!range || (line >= range[0] && line <= range[1])) {
      lines++;
      bytes += end - start;
    }
    if (range && line >= range[1]) break;
    start = end;
    line++;
  }
  if (range && lines === 0) return 'Requested range starts beyond EOF.';
  if (!range && lines > limits.fullReadLines) return 'Full-file read exceeds the line limit. Ask Fleet Explore first.';
  if (bytes > (range ? limits.excerptBytes : limits.fullReadBytes)) {
    return 'Requested text exceeds the byte limit, even though its line range may be small.';
  }
  return null;
}

export function evaluate(event, role = 'dispatch', config = policy, workspace = root) {
  try {
    if (!['dispatch', 'coordinator', 'bounded-reader'].includes(role)) return 'Unknown guard role.';
    if (!object(event)) return 'Invalid hook payload.';
    const tool = uniqueField(event, ['tool_name', 'toolName']);
    let args = uniqueField(event, ['tool_input', 'toolArgs']);
    if (typeof args === 'string') args = JSON.parse(args);
    if (typeof tool !== 'string' || !object(args)) return 'Invalid tool name or arguments.';
    if (role === 'dispatch') return delegates.has(tool) ? delegation(args, config) : null;
    if (role === 'coordinator') {
      return delegates.has(tool) ? delegation(args, config) : 'The coordinator can only delegate to named fleet specialists.';
    }
    if (!reads.has(tool)) {
      return 'This specialist only reads bounded source excerpts. Return a context request to the coordinator for Fleet Explore or Fleet Task. Do not use shell, search, MCP or nested agents as a workaround.';
    }
    return boundedRead(args, event, config, workspace);
  } catch (error) {
    // Never echo supplied source content or malformed JSON into model context.
    return `Fleet guard could not validate this call (${error.code || error.name}). Check the host tool schema and request bounded context.`;
  }
}

export function response(reason, camelCase = false) {
  // A passing guard returns no permission decision: preserve ordinary host approvals.
  if (!reason) return {};
  const decision = {permissionDecision: 'deny', permissionDecisionReason: reason};
  return camelCase ? decision : {hookSpecificOutput: {hookEventName: 'PreToolUse', ...decision}};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let event;
  let reason;
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (Buffer.byteLength(raw) > 1048576) throw new Error('Oversized payload');
    event = JSON.parse(raw);
    reason = evaluate(event, process.argv[2] || 'dispatch');
  } catch {
    reason = 'Fleet guard received malformed or oversized JSON. Tool execution blocked.';
  }
  // Include both documented envelope forms only when input cannot identify the host.
  const output = event ? response(reason, Object.hasOwn(event, 'toolName')) : {
    ...response(reason, true), ...response(reason, false)
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
