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

- The coordinator remains delegation-only and now has an explicit GPT-5.6 Sol pin.
- A workspace PreToolUse hook checks named fleet dispatch, rejects model overrides
  outside each worker's pin and caps delegation input at 16,000 UTF-8 bytes.
- VS Code scoped hooks give the coordinator an additional tool gate. Code Review,
  Rubber Duck and Security Review have bounded source reads and no shell/search
  tools. The guard also rejects alternate tool calls if a client exposes them.
- Cheap Explore, Task and General Purpose workers are not subject to the scoped
  read gate. They retain the tools needed to do their job. This prevents a blocked
  expensive read from triggering a cheap worker that is blocked identically.
- Reviewers receive an exact diff packet prepared by Task. They must read the whole
  assigned diff and relevant original source, not trust a cheap model's review.
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
| Named dispatch and explicit model-override guard | Workspace hook | Workspace hook |
| Coordinator has only delegation tools | Profile plus scoped hook | Profile tool list |
| Expensive reviewers cannot use shell/search | Profile plus scoped hook | Profile tool list |
| Full read <=350 lines and 24,000 bytes | Scoped hook | Not enforced by this implementation |
| Excerpt <=120 lines and 12,000 bytes | Scoped hook | Not enforced by this implementation |
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

`working` means unstaged tracked changes. `staged` means staged changes. `base main`
compares the supplied commit with the current working tree, including staged and
unstaged tracked changes. It is not a merge-base/three-dot comparison. Use an
explicit merge-base SHA if that is the desired scope. No base is assumed.

The helper invokes git with argv (no shell), disables external diff/textconv,
writes a private ignored packet, and prints only path/count/comparison metadata.
It refuses diffs above 8 MiB instead of truncating them. Untracked files are NOT
included: supply their paths separately. Do not commit packets. Delete them when
the review is complete.

Pass the packet path and scope to Code Review. Read every assigned hunk in <=120
line excerpts, then inspect exact source for suspected issues. A guard denial
requires a narrower read or `CONTEXT_NEEDED` back to the coordinator, who calls
Explore and supplies verified locations. Never turn incomplete coverage into a
"no defects" result. Splitting a review into intentional chunks is allowed;
chunking every source file for discovery defeats the cost objective.

## Boundaries and failure behavior

These are local cost controls for cooperative developers, not a security sandbox
or enforceable company budget. They do not stop users selecting another agent,
disabling hooks, editing profiles or pasting large content directly into chat.
They do not cap total session tokens, repeated small reads, reasoning tokens,
worker final responses, or research web output. Output brevity remains an agent
instruction. No saving percentage is promised.

The scoped gate allows only explicitly supported file-read tool names and schemas:
`read_file`/`readFile`/`read/readFile` with `filePath`, `Read` with `file_path`, and
CLI-compatible `view` with `path`. Excerpts use `startLine/endLine`, `offset/limit`,
or `view_range`. The offset/limit form conservatively counts one extra line
because the current VS Code V2 reader includes that endpoint; use limit <=119.
Out-of-file starting ranges are denied. Dispatch supports `runSubagent`, `agent/runSubagent`,
`run_subagent`, `task`, `Task`, `Agent`, and a single `agentName`, `agent_type`,
`subagent_type` or `agent` field. Unknown/ambiguous scoped calls are denied. The VS Code read schemas were also checked against its
[read tool source](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/extension/tools/node/readFileTool.tsx).
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

1. Verify all eight profiles appear and inspect actual resolved worker models.
2. Have Code Review try a full read of a 500-line file. Expect a denial before
   file contents enter its context. Then read 20 lines successfully.
3. Attempt an offset-only read, a huge limit, a shell `cat` and a content search
   from the same reviewer. Each must be blocked or unavailable.
4. Have Fleet Explore read that same file. It must work without a delegation loop.
5. Ask the coordinator to use the built-in general-purpose worker or override
   Explore to an expensive model. Expect dispatch refusal.
6. Change a CLI worker's configured model to an unavailable test value in a
   disposable installation. Confirm refusal, not parent-model fallback.
7. Run a small change through implementation, exact diff preparation, full scoped
   review and tests. Verify unchanged successful checks are not repeated.
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
