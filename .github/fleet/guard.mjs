// No network, dependencies, subprocesses, or source-content logging.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const policy = JSON.parse(fs.readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
const coordinatorName = 'Subagent Fleet';
const delegates = new Set(['task', 'Agent', 'Task', 'runSubagent', 'run_subagent', 'agent/runSubagent']);
const reads = new Set(['read_file', 'readFile', 'read/readFile', 'Read', 'view']);
// Model-facing VS Code tool ids. Text/file searches require an explicit result limit.
// Directory and usage output sizes remain controlled by the host.
// Deliberately absent: get_changed_files (whole diff), semantic_search (uncapped chunks), search_subagent.
const searches = new Set(['grep_search', 'file_search', 'list_dir', 'vscode_listCodeUsages']);
const packetPath = /^\.fleet-review-[^/]+\/changes\.diff$/;
const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;

// Messages written by this guard. They hold static text and field names only, never
// supplied values, so they are safe to return to the model. Any other error stays generic.
class GuardError extends Error {}

function uniqueField(args, names) {
  const values = names.filter(n => Object.hasOwn(args, n)).map(n => args[n]);
  if (values.length !== 1) throw new GuardError(`Expected exactly one of ${names.join(', ')}.`);
  return values[0];
}

function delegation(args, config, strict) {
  const fields = ['agentName', 'agent_type', 'subagent_type', 'agent'];
  // The workspace hook fires in every session. Unless the policy says otherwise,
  // delegation that does not involve the fleet is none of its business.
  const lenient = !strict && config.dispatchUnknown !== 'deny';
  if (lenient && !fields.some(n => Object.hasOwn(args, n))) return null;
  const name = uniqueField(args, fields);
  if (typeof name !== 'string' || !name) return 'Delegation requires a named fleet specialist.';
  const wanted = normalize(name);
  const agent = Object.entries(config.agents).find(([id, item]) =>
    wanted === normalize(id) || wanted === normalize(item.name))?.[1];
  if (!agent) {
    // A near miss must not skip the model-override check, and the coordinator must not recurse.
    const near = [coordinatorName, ...Object.entries(config.agents).flatMap(([id, item]) => [id, item.name])]
      .some(known => wanted.includes(normalize(known)));
    if (lenient && !near) return null;
    return 'Use the exact name of a Fleet specialist. Built-in and recursive coordinator delegation are disabled.';
  }
  // Reject hidden/ambiguous overrides. Only the documented model field is allowed.
  if (Object.keys(args).some(key => /model/i.test(key) && key !== 'model')) {
    return 'Unsupported model override field. Only "model" is recognised; omit it.';
  }
  if (Object.hasOwn(args, 'model') && ![agent.model, agent.cliModel].includes(args.model)) {
    return `Use ${agent.name} with its pinned model ${agent.model}; omit the model override.`;
  }
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > config.limits.delegationBytes) {
    return 'Delegation context is too large. Pass paths, task, constraints and acceptance criteria, not whole files or logs.';
  }
  return null;
}

// Returns the inclusive line span used for byte accounting and the line count the caller asked for.
function readBounds(args) {
  const families = [
    ['startLine', 'endLine'], ['offset', 'limit'], ['view_range']
  ].filter(keys => keys.some(key => Object.hasOwn(args, key)));
  if (families.length > 1) throw new GuardError('Ambiguous range formats. Use one range form.');
  if (!families.length) return null;
  if (families[0][0] === 'startLine') {
    if (!positive(args.startLine) || !positive(args.endLine) || args.endLine < args.startLine) {
      throw new GuardError('Use positive integer startLine and endLine for a bounded range.');
    }
    return {start: args.startLine, end: args.endLine, count: args.endLine - args.startLine + 1};
  }
  if (families[0][0] === 'offset') {
    const start = args.offset ?? 1;
    if (!positive(start) || !positive(args.limit) || !Number.isSafeInteger(start + args.limit)) {
      throw new GuardError('Use a positive offset and a finite positive limit. Offset alone is not bounded.');
    }
    // VS Code V2 includes the line at start + limit. Bytes count that extra line;
    // the line ceiling compares the limit the caller actually asked for.
    return {start, end: start + args.limit, count: args.limit};
  }
  if (!Array.isArray(args.view_range) || args.view_range.length !== 2 ||
      !args.view_range.every(positive) || args.view_range[1] < args.view_range[0]) {
    throw new GuardError('Use a finite positive view_range; -1 is not bounded.');
  }
  return {start: args.view_range[0], end: args.view_range[1], count: args.view_range[1] - args.view_range[0] + 1};
}

function contained(supplied, event, workspace) {
  if (typeof supplied !== 'string' || !supplied || supplied.includes('\0')) throw new GuardError('Invalid path.');
  const base = fs.realpathSync(workspace);
  const target = fs.realpathSync(path.resolve(event.cwd || workspace, supplied));
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new GuardError('Access outside the repository is blocked, including symlinks.');
  }
  // Resolved through symlinks, so a link named like a review packet does not qualify as one.
  return {target, relative: relative.split(path.sep).join('/')};
}

function boundedSearch(tool, args, event, config, workspace) {
  if (['grep_search', 'file_search'].includes(tool) &&
      !(positive(args.maxResults) && args.maxResults <= config.limits.searchMaxResults)) {
    return `Set maxResults to a positive integer of at most ${config.limits.searchMaxResults}. Host defaults are not accepted.`;
  }
  if (Object.hasOwn(args, 'includeIgnoredFiles') && args.includeIgnoredFiles !== false) {
    return 'Searching ignored files is blocked. Search tracked source only.';
  }
  if (tool === 'list_dir') contained(uniqueField(args, ['path']), event, workspace);
  return null;
}

function boundedRead(args, event, config, workspace) {
  const {target: file, relative} = contained(uniqueField(args, ['filePath', 'file_path', 'path']), event, workspace);
  const stat = fs.statSync(file);
  if (!stat.isFile()) return 'Use list_dir or Fleet Explore for directories; only regular files can be read here.';
  const range = readBounds(args);
  const limits = config.limits;
  const packet = packetPath.test(relative);
  const tooLarge = 'This file is too large to read whole. Return CONTEXT_NEEDED with a specific question about it for Fleet Explore, ' +
    `or search for the symbol and read a bounded range of at most ${limits.excerptLines} lines.`;
  if (stat.size > limits.scanBytes) return 'File exceeds inspection limit. Ask Fleet Explore for the relevant source locations.';
  if (!range && !packet && stat.size > limits.fullReadBytes) return tooLarge;
  const data = fs.readFileSync(file);
  if (data.includes(0)) return 'Binary reads are not supported.';
  let total = 0, lines = 0, bytes = 0, start = 0;
  for (let i = 0; i <= data.length; i++) {
    if (i !== data.length && data[i] !== 10) continue;
    if (i === data.length && i === start) break;
    const end = i < data.length ? i + 1 : i;
    total++;
    if (!range || (total >= range.start && total <= range.end)) {
      lines++;
      bytes += end - start;
    }
    start = end;
  }
  if (range && lines === 0) return 'Requested range starts beyond EOF.';
  if (packet) {
    // The assigned diff is mandatory reading: chunking it only adds turns. Bound its total size instead.
    return bytes > limits.packetBytes
      ? 'Review packet exceeds the size limit. Ask the coordinator to split the review with path-scoped packets.'
      : null;
  }
  // VS Code's default read schema always carries a range, so a range that spans the file is a full read.
  if (!range || (range.start === 1 && range.end >= total)) {
    return total > limits.fullReadLines || bytes > limits.fullReadBytes ? tooLarge : null;
  }
  if (Math.min(range.count, lines) > limits.excerptLines) return `Request at most ${limits.excerptLines} lines per range.`;
  if (bytes > limits.excerptBytes) return 'Requested text exceeds the byte limit, even though its line range may be small.';
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
    if (role === 'dispatch') return delegates.has(tool) ? delegation(args, config, false) : null;
    if (role === 'coordinator') {
      return delegates.has(tool) ? delegation(args, config, true) : 'The coordinator can only delegate to named fleet specialists.';
    }
    if (searches.has(tool)) return boundedSearch(tool, args, event, config, workspace);
    if (!reads.has(tool)) {
      return 'This specialist only searches and reads bounded source. Return CONTEXT_NEEDED to the coordinator for Fleet Explore or Fleet Task. Do not use shell, changed-files, MCP or nested agents as a workaround.';
    }
    return boundedRead(args, event, config, workspace);
  } catch (error) {
    if (error instanceof GuardError) return error.message;
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
