# Strict fleet routing

Implemented against official documentation checked on 2026-09-17. Requires Node.js
20 or newer on the machine running the agent (including SSH/container extension
hosts). Uses only Node built-ins. No model API key, Portal subscription or npm
installation is needed.

This adapts the hook-based routing pattern described in
[Spotify's Portal article](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90)
and the [Shunt plugin](https://github.com/sorantis/portal-ai-plugins/tree/add-shunt-claude/plugins/shunt)
to this repository's Copilot specialists. Work stays within Copilot; Portal modes
and the Claude Code plugin are not installed. Shunt's reported savings have not
been measured for this fleet.

## What changes

- The coordinator is pinned to GPT-5.6 Sol. It handles small tasks directly using
  read, search, edit and execute tools, and delegates substantial bounded work.
  Task-size routing is advisory, not a hard cost limit. Routine verified edits do
  not automatically trigger independent review; user/repository requirements and
  remaining material correctness risk still trigger review.
- A workspace PreToolUse hook checks fleet dispatch: it rejects model overrides
  outside each worker's pin and caps delegation input at 16,000 UTF-8 bytes. In
  the VS Code variant it ignores delegation that does not name a fleet agent, so
  ordinary sessions and other custom agents in the same workspace keep working.
- VS Code scoped hooks restrict coordinator delegation to named fleet specialists,
  while allowing direct work under ordinary host permissions. Code
  Review, Rubber Duck and Security Review have bounded source reads and no shell.
  Code Review and Security Review also keep text search, file search, directory
  listing and usages, because a search hit is already a small targeted read. The
  guard rejects every other tool if a client exposes it, including changed-file,
  semantic-search and nested-agent tools.
- Cheap Explore, Task and General Purpose workers are not subject to the scoped
  read gate. They retain the tools needed to do their job. This prevents a blocked
  expensive read from triggering a cheap worker that is blocked identically.
- Reviewers receive an exact diff packet prepared directly by the coordinator or by Task. They read the whole
  assigned diff in as few reads as the host allows, and relevant original source
  in bounded ranges. They do not trust a cheap model's review.
- As in Shunt, only whole-file reads of large files are blocked. The cheap model
  that answers questions about such a file is Fleet Explore. Unlike Shunt this is
  not a single hop: the reviewer returns `CONTEXT_NEEDED` and the coordinator
  restarts it, so the coordinator asks Explore up front when it can foresee the
  need. Explore findings are unverified hints; the article notes that worker
  summaries lack reliable line numbers, so reviewers confirm every location.
- Implementation writes code directly into files and returns paths, not full code.
- Duplicate checks on unchanged code are skipped. Context gathering may cause one
  explicit retry; repeated failures are returned as blockers instead of looping.

## Install

From this repository, install into another project:

```bash
node scripts/install.mjs --host vscode --dest /absolute/path/to/project
```

The installer copies only fleet-owned paths. It refuses conflicting files before
writing anything. After reviewing changes, `--force` can replace those fleet
files. It never replaces AGENTS.md, project instructions, editor settings or other
agents. Add `.fleet-review-*/` to the destination `.gitignore`.
Symlinks at or below the requested destination are refused, including dangling
links. Ancestor aliases such as macOS `/var` are supported.

For VS Code, merge the following settings using the Settings UI or your existing
workspace settings file. Do not replace an existing settings file:

```json
{
  "chat.useCustomAgentHooks": true,
  "chat.subagents.allowInvocationsFromSubagents": false
}
```

Open the destination repository root as the workspace. Enable `agent/runSubagent`
and select **Subagent Fleet**. Hook commands run with `cwd: "."` relative to the
repository root; source paths are checked against the installed repository.
The source checkout itself is the VS Code variant, so no install is needed to use
it there. Enable the same editor settings.

For CLI, generate a separate host-specific installation:

```bash
node scripts/install.mjs --host cli --dest /absolute/path/to/project
cd /absolute/path/to/project
copilot --agent subagent-fleet --model gpt-5.6-sol
```

CLI generation uses API-style model IDs and `modelPolicy: required`, strips
unverified agent-frontmatter hooks, and installs the camelCase dispatch hook.
Do not install both variants over the same profiles simultaneously. Use separate
worktrees for a mixed-client pilot. CLI model IDs are configured aliases: confirm
each one in your client's model picker before using it. If an authored model is
unavailable, fix the mapping/access rather than weakening required enforcement.
Do not use Auto with this fleet. GitHub documents special model inheritance under
Auto, and its interaction with required policy needs a live client check.

CLI also supports a soft session cap, for example:

```text
/limits set max-ai-credits 100
```

100 credits is $1 of metered model consumption. A response can finish beyond the
limit. This is not a company spending cap; use GitHub's billing controls as well.

## Actual enforcement by host

| Control | VS Code setup | CLI setup |
| --- | --- | --- |
| Model-override and delegation-size guard for fleet agents | Workspace hook | Workspace hook |
| Non-fleet and built-in delegation blocked | Coordinator scoped hook only; other sessions unaffected | Workspace hook, all sessions (`dispatchUnknown: "deny"`) |
| Coordinator can read, search, edit and execute directly | Profile; scoped hook passes direct calls | Profile tool list |
| Expensive reviewers cannot use shell | Profile tool list plus scoped hook | Profile tool list |
| Reviewers cannot use changed-file, semantic-search or nested-agent tools from the `search` set | Scoped hook | Not enforced by this implementation |
| Text/file searches require an explicit `maxResults` of 1–100, no ignored files | Scoped hook validates requests; host renders results | Not enforced by this implementation |
| Directory listing and usages output size | Host limits; no fleet result-count cap | Host limits |
| Whole-file read <=350 lines and 24,000 bytes, including a range that spans the file | Scoped hook | Not enforced by this implementation |
| Line range <=500 lines and 40,000 bytes | Scoped hook | Not enforced by this implementation |
| Review packet read whole up to 120,000 bytes | Scoped hook | Not enforced by this implementation |
| Unavailable worker model refuses dispatch | Inspect actual host behavior | Native `modelPolicy: required` |
| Model cost-tier ceiling | Parent must permit worker tier | Check installed client behavior |

The CLI hook's dispatch mode deliberately does not gate all file reads: its
PreToolUse payload does not reliably identify the current specialist. Inferring
that from one shared session flag would break concurrent workers. Do not advertise
the CLI variant as full Spotify-style read enforcement. Use the VS Code variant
for that pilot. Other IDEs/cloud-agent enforcement is not claimed.

The source's `model:` pins and `policy.json` must match. When changing a pin, change
both and rerun tests/install. No automatic fallback to an expensive model is
configured. VS Code explicit dispatch model arguments take precedence over profile
preferences, which is why the dispatch hook checks them.

## Review without expensive shell output

Ask Fleet Task to run one of these with an explicit comparison:

```bash
node .github/fleet/review-packet.mjs working
node .github/fleet/review-packet.mjs staged
node .github/fleet/review-packet.mjs base main
```

`working` means unstaged tracked changes. `staged` means staged changes.
`merge-base main` compares the merge base of `main` and `HEAD` with the current
working tree, including staged and unstaged tracked changes. Prefer it for branch
reviews. `base main` compares the `main` commit itself with the working tree, so
on a branch that is behind `main` it also contains the reverse of newer `main`
commits. No ref is assumed. `merge-base` refuses shallow clones and unrelated
histories instead of guessing a base.

Append `-- <path>...` to any mode to scope a packet. Paths are literal, not globs.
Use this to split a review whose packet exceeds 120,000 bytes.

The helper invokes git with argv (no shell), disables external diff/textconv,
writes a private ignored packet, and prints only path, counts and resolved SHA
metadata. The supplied ref and paths are not echoed.
It refuses diffs above 8 MiB instead of truncating them. Untracked files are NOT
included: supply their paths separately. Do not commit packets. Delete them when
the review is complete.

Pass the packet path and scope to Code Review. The packet is exempt from the line
limits: chunking mandatory reading only adds turns, each of which re-bills the
accumulated context. VS Code's reader returns at most 2,000 lines per call, so a
larger packet still takes more than one read. The reviewer then searches for
callers and definitions and reads the cited ranges. A guard denial requires a
narrower read, a search, or `CONTEXT_NEEDED` back to the coordinator, who asks
Explore a specific question. Never turn incomplete coverage into a "no defects"
result. Paging through every source file in ranges defeats the cost objective.

## Boundaries and failure behavior

These are local cost controls for cooperative developers, not a security sandbox
or enforceable company budget. They do not stop users selecting another agent,
disabling hooks, editing profiles or pasting large content directly into chat.
They do not cap total session tokens, repeated reads, reasoning tokens,
worker final responses, or research web output. Output brevity remains an agent
instruction. No saving percentage is promised.

The scoped gate allows only explicitly supported file-read tool names and schemas:
`read_file`/`readFile`/`read/readFile` with `filePath`, `Read` with `file_path`, and
CLI-compatible `view` with `path`. Excerpts use `startLine/endLine`, `offset/limit`,
or `view_range`. VS Code's default reader always sends `startLine/endLine`, so a
range that starts at line 1 and reaches the last line is treated as a whole-file
read. The offset/limit form counts the bytes of one extra line because the VS
Code V2 reader includes that endpoint; the line ceiling uses `limit` itself.
Requested spans are clamped to the file's real length. Out-of-file starting
ranges are denied. Reviewer search passes for the model-facing ids `grep_search`,
`file_search`, `list_dir` and `vscode_listCodeUsages`. Text and file searches must
provide an explicit positive integer `maxResults` of at most 100; omitted or
invalid limits are denied rather than relying on host defaults. Directory listing
and usages do not support this limit and rely on host output limits.
`includeIgnoredFiles: true` and `list_dir` paths outside the repository are denied.
Known gap: a match-all `grep_search` scoped to one file returns up to 100 of its
lines. That is accepted for cooperative agents and discouraged in the profiles. Dispatch supports `runSubagent`, `agent/runSubagent`,
`run_subagent`, `task`, `Task`, `Agent`, and a single `agentName`, `agent_type`,
`subagent_type` or `agent` field. Unknown/ambiguous scoped calls are denied. In
the workspace hook, a name that is not a fleet agent passes unless it contains a
fleet id or name (for example `plugin:fleet-code-review`), which must not skip the
model check, or names the coordinator. Set `"dispatchUnknown": "deny"` in
`policy.json` to block all non-fleet delegation; the CLI installer does this
because the CLI has no scoped coordinator hook. Guard-authored denial reasons are
static text and field names; supplied paths, keys and values are never echoed. The VS Code read schemas were also checked against its
[read tool source](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/tools/node/readFileTool.tsx).
Adapters are unit-tested, not evidence of every host's actual emitted schema.
Inspect agent logs during the smoke check and add a tested adapter if necessary.

Passing checks return `{}` so normal host permissions still apply. Malformed
payloads return a denial. Missing runtime/scripts, disabled hooks and host hook
timeouts are outside the guard's control; CLI documents timeout fail-open behavior.
Failing to load a guard is not equivalent to successful enforcement.
Do not deploy based only on a successful unit test. No source contents are logged.

## Verification

```bash
node --test tests/*.test.mjs
```

Live smoke checks on a disposable branch, with current Copilot/VS Code:

1. Verify the coordinator, seven specialists and Economy appear and inspect actual resolved worker models.
2. Have Code Review try to read all of a 500-line file. Expect a denial that
   names Fleet Explore before file contents enter its context. Then read 20
   lines, and a full review packet, successfully.
3. Attempt an offset-only read, a 600-line range, a shell `cat` and a changed-files
   call from the same reviewer. Each must be blocked or unavailable. A text
   search with `maxResults: 100` must work; the same search without `maxResults`
   must be denied. Record the `tool_name` values the host actually emits and verify
   that the host honours the requested result limit.
4. Have Fleet Explore read that same file. It must work without a delegation loop.
5. In an ordinary (non-fleet) session, confirm a built-in subagent still runs.
   Then ask the coordinator to use the built-in general-purpose worker or override
   Explore to an expensive model. Expect dispatch refusal.
6. Change a CLI worker's configured model to an unavailable test value in a
   disposable installation. Confirm refusal, not parent-model fallback.
7. Ask Sol for a targeted lookup and a small edit with checks. Verify direct tool
   use, without compulsory delegation or a separate review. Then explicitly request
   independent review; verify exact diff preparation and scoped review. Verify
   unchanged successful checks are not repeated.
8. Test the parent/worker model tier restriction. If Security Review is refused,
   select it directly. Do not quietly raise all sessions to Astra.

Record resolved models, total credits (all agents), retries, elapsed time, accepted
changes and review coverage. Compare against the original fleet on matched tasks.
The implementation was tested locally with synthetic hook payloads; an authenticated
Copilot host run remains necessary before company rollout.

## Sources

- [VS Code scoped hooks](https://code.visualstudio.com/docs/agent-customization/hooks)
- [VS Code hook I/O](https://code.visualstudio.com/docs/agents/reference/hooks-reference)
- [VS Code subagent model precedence and tiers](https://code.visualstudio.com/docs/agents/run/subagents)
- [CLI modelPolicy and model resolution](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [CLI hook contracts and failure modes](https://docs.github.com/en/copilot/reference/hooks-reference)
- [CLI soft credit limits](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/set-session-limit)
