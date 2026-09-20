# Shunt-style routing for GitHub Copilot

Choose a strong model in your normal Copilot **agent** conversation. This plugin redirects large reads to a cheaper Copilot worker and provides a skill that generates predictable files without printing their contents into the main conversation. It is independent of the fleet profiles in this repository: no coordinator selection, agent-profile installation, or changes to those profiles are required.

The package targets **Copilot CLI, VS Code Copilot agent chat, and the GitHub Copilot desktop app**, using their supported plugin mechanism. All three run the same local Node helpers and use an authenticated **Copilot CLI** as the worker backend. This does not target GitHub.com chat, mobile chat, or a remote cloud agent environment.

## What happens

```text
Your selected main model
  │
  ├─ small / targeted read ───────────────────────► normal host tool
  │
  ├─ large read ─► fast PreToolUse hook DENIES it
  │                 └─ main follows redirect and calls bulk-read.mjs
  │                      ├─ helper loads source directly from disk
  │                      ├─ isolated cheap CLI worker receives source via stdin
  │                      └─ bounded summary returns to main conversation
  │
  └─ predictable generation ─► shunt-code-writer skill
                                ├─ cheap worker receives spec + reference
                                ├─ helper publishes generated file on disk
                                └─ path / counts / hash return to main
```

The hook itself does not call a model or substitute a tool result. It denies the expensive read and supplies instructions for the next tool call, as Shunt does. The main model still has to follow that redirect. **Writes are skill-guided, not automatically intercepted.** A Write hook runs after the main model has already generated the code and cannot recover those output tokens. See [the upstream analysis](UPSTREAM.md).

## Requirements

- Node.js 20+ and a current authenticated Copilot CLI, available to the host's shell. The live backend checks used CLI **1.0.86** on macOS; older CLI versions with different JSONL output may be rejected.
- Access to the configured worker model, initially `gpt-5.6-luna`. Use `copilot login` and `/model` to check your account. Worker requests consume your Copilot allowance; “cheap” depends on your plan and model pricing.
- A host version with plugins and command hooks enabled, a trusted project, and permission to execute the helper with Node. Organizational policy still applies.
- For VS Code remote development, install Node and Copilot CLI in the environment where the agent's terminal runs. A CLI installed only on the local laptop is insufficient for a remote terminal.

`node --version` and `copilot --version` must work in that environment. If the executable is not on the desktop app's PATH, set `SHUNT_COPILOT_BIN` to its absolute executable path in the environment used to launch the app. This variable is a single executable path, not a shell command with arguments. On Windows, use a native Copilot executable rather than an npm `.cmd` shim; Windows execution has not been live-tested.

## Install in Copilot CLI

For a session using this checkout, replace the example absolute path:

```sh
copilot --plugin-dir /absolute/path/agent-setup-copilot/shunt-copilot
```

For a persistent installation:

```sh
copilot plugin install /absolute/path/agent-setup-copilot/shunt-copilot
copilot plugin list
```

Start a new session, choose your main model with `/model`, and use the normal agent. The plugin supplies hooks and skills, not a parent agent profile. See the [CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference).

Approve the helper's Node command and access to its plugin directory when the host asks. For a plugin outside the project, CLI can also be launched with `--add-dir /absolute/path/agent-setup-copilot/shunt-copilot` to trust that directory. Granting file-read permission alone is insufficient to execute the worker helper. The plugin never auto-approves shell commands.

## Install in VS Code

Add the local plugin directory to **User Settings JSON**, retaining any existing entries:

```json
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "/absolute/path/agent-setup-copilot/shunt-copilot": true
  }
}
```

Open a trusted project and start a new Copilot chat in **Agent** mode. Select your preferred strong main model. Confirm the two skills are visible in Chat customizations and hooks are enabled. This plugin uses session-wide plugin hooks; it does not depend on the fleet's `chat.useCustomAgentHooks` setting for profile-scoped hooks. [VS Code documents local plugin registration and hook support](https://code.visualstudio.com/docs/agent-customization/agent-plugins).

## Install in the GitHub Copilot app

This repository includes a marketplace registration at `.github/plugin/marketplace.json` for the separate `shunt-copilot/` package.

1. Open **Customize → Plugins**.
2. Use the icon beside the marketplace dropdown to add this repository's Git URL: `https://github.com/sanjit-roopra/agent-setup-copilot.git`.
3. Find **shunt-copilot** in **copilot-context-tools** and install it.
4. Start a fresh project session with your chosen main model and the normal agent.
5. Run the smoke check below. CLI authentication and executable availability are still required for the worker.

**Before this PR is merged:** the default-branch URL will not contain the new marketplace. Use the feature branch as the marketplace ref if your app supports it, or install after merge. CLI explicitly supports `owner/repo#ref` marketplace sources; the app documentation only promises GitHub repository / Git URL input, so branch-ref handling in its UI is not claimed as verified. CLI and VS Code can test the local checkout immediately.

The [app customization documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app) explicitly lists hooks and skills as plugin capabilities. This implementation uses that documented plugin path, rather than assuming that VS Code agent-frontmatter hooks are portable.

## Use and verify

Create a disposable fixture from this repository's root:

```sh
node shunt-copilot/scripts/smoke-fixture.mjs --dest /tmp/copilot-shunt-smoke
```

Use a new destination on each run. On Windows, substitute an appropriate temporary path. Open that folder as the project in each host, with the plugin enabled. In a normal agent conversation ask:

> First attempt a whole-file read of large.txt without a line range. Then follow the routing instructions to tell me RETRY_LIMIT and its line number. Do not read the file in chunks.

Expected: the first read is denied with `SHUNT_COPILOT_READ_REDIRECT`; the agent calls `bulk-read.mjs`; a worker summary identifies **7 at line 200**. A line-range read of lines 195–205 is allowed. The main model remains the one you selected. Merely receiving the correct answer without observing the denial does not prove the hook loaded.

Then ask:

> Use shunt-code-writer to create generated.mjs with a double(value) function, following reference.mjs. Return only the file metadata, then verify double(4) equals 8.

Expected: the helper returns metadata, the file exists, and the verification succeeds. The strong model should not first compose the complete implementation or then dump the whole generated file into chat. Skills are selected by the model; naming the skill makes this smoke test deterministic.

To check the worker independently of host discovery:

```sh
node shunt-copilot/scripts/bulk-read.mjs --root /tmp/copilot-shunt-smoke --question "What is RETRY_LIMIT and its line?" --paths large.txt
node shunt-copilot/scripts/code-write.mjs --root /tmp/copilot-shunt-smoke --spec "Export double(value), returning value times two." --reference reference.mjs --target candidate.mjs
```

No `--target` means an error, not source printed to stdout. Existing targets are refused, including symlinks and a file created while the worker was running. For revisions, generate a candidate path and review/merge the intended changes. Parent directories must already exist.

## Scope of enforcement

| Operation | Behavior |
| --- | --- |
| Whole-file native read above 350 lines or 24 KiB | Denied and redirected |
| Explicit range of at most 350 lines / 24 KiB | Allowed through normal host permissions |
| Simple `head`/`tail`/`Get-Content` with an explicit count of at most 350 lines / 24 KiB | Allowed through normal host permissions |
| Invalid, open-ended or oversized range | Denied |
| File larger than 400,000 bytes | Native reads denied without scanning it; split the task or use a targeted shell query |
| Simple `cat`, `head`, `tail`, `less`, `more`, `Get-Content`, `gc`, `type` of a large file | Denied; even head/tail must use the native range tool for an exception |
| Pipelines, redirections, compound shell commands, scripts, unknown tools | Not inspected by this limited shell parser |
| Three or more small files, saved diffs | Skill-guided delegation; no aggregate-read counter |
| Native writes, edits and patches | Not blocked; code-writer delegation must happen before generation |
| Search, terminal output, attachments, indexed context, remote/MCP reads | No universal output interception or size cap |

The guard recognizes native `view` / `Read` and VS Code `read_file` / `readFile` / `read`, including `view_range`, `startLine/endLine`, and `offset/limit` arguments. Shell adapters cover `bash`, `Bash`, `powershell`, `run_in_terminal`, `runInTerminal`, and `execute_command`. Unknown future tool names need adapters.

This is a context-cost guard, not an adversarial security boundary. It does not guarantee that **all** large data is routed, prevent deliberate chunking/bypasses, or override host trust settings. Hooks can be disabled; CLI hook timeouts are documented to fail open. Hooks perform only bounded local reads and never wait for the cheap model. [Hook contract and timeout behavior](https://docs.github.com/en/copilot/reference/hooks-reference).

Saying “use a fleet of agents” does not turn this into a subagent-model policy. The plugin is active without selecting a special agent, but any subagent must have the host's plugin hooks/skills available to participate. Custom profiles without shell access cannot call these helpers. The existing Fleet coordinator/reviewer profiles deliberately restrict shell tools; keep their workflow separate or route requests through a specialist that can execute the helper.

## Configuration and data flow

`config.json` defines the model, read thresholds, encoded input ceiling, summary ceiling (12,000 bytes), code ceiling (200,000 bytes), and worker deadline (120 seconds). Change a local source copy and reload the plugin; do not edit an installed cache you expect upgrades to preserve. Set `SHUNT_COPILOT_MODEL` in the host environment to override just the worker's raw model ID. Set `SHUNT_COPILOT_MIN_LINES` to a positive integer to override the line threshold, as upstream's `SHUNT_MIN_LINES` does; any other value is ignored. `auto` is refused. No fallback model is requested.

Workers start in a fresh temporary directory with a `tools: []` profile, `modelPolicy: required`, an empty available-tool list, explicit exclusions for `skill` and `sql`, and a deny-all pre-tool hook. The main process verifies model identity in JSONL events and rejects tool attempts, missing final answers, errors, and oversized results. It only emits the final summary or file metadata, never the CLI's raw event stream (which echoes source). Source content travels via stdin, not shell interpolation or command-line arguments.

No session is resumed or replayed between invocations. Temporary helper files and logs are removed. **This is not Portal's ephemeral storage contract:** Copilot CLI may retain worker sessions in its normal local history, and user-configured MCP servers may initialize during CLI startup even though worker tool calls are disabled. `--no-remote-export` disables remote session export; model requests still go through your authenticated Copilot service normally. Summaries and generated code remain untrusted output to verify with focused reads and tests.

## Measure the effect

`node scripts/benchmark.mjs` runs the same prompts through Copilot CLI with and without this plugin and compares the CLI's own usage figures, including the worker's cost. See [BENCHMARK.md](BENCHMARK.md) for how to run it and read the results.

## Validation status

As of 2026-09-18:

| Layer / host | Evidence |
| --- | --- |
| Unit and subprocess contracts | 29 new tests plus the 32 existing fleet tests passed on macOS, Node 25.2.1 |
| Copilot CLI 1.0.86 plugin hook | Live authenticated session discovered the plugin and denied a 400-line whole-file `view` read |
| Cheap reader | Live Luna worker found the synthetic value at line 200; only its summary returned |
| Complete read routing | Live Sol main session received the hook denial, ran the Luna helper, received an 11-byte answer for a 9,504-byte request, and finished on Sol; helper shell permission and plugin-directory access were granted |
| Cheap writer | Live Luna worker wrote a module with metadata-only output; importing it verified `double(4) === 8` |
| VS Code | Official plugin/hook contract checked; adapter tests passed; interactive host smoke remains to be run |
| GitHub Copilot app | Official plugin capability and install path checked; shared hook-envelope tests passed; interactive host smoke remains to be run |

The last two rows are documentation and contract coverage, **not a claim of live end-to-end validation**. No savings percentage or quality benchmark is claimed.

Run the offline suite from the repository root:

```sh
node --test tests/*.test.mjs shunt-copilot/tests/*.test.mjs
```

If a large read succeeds silently, check plugin activation and hook logs first. In VS Code, use the GitHub Copilot Chat Hooks output / agent debug logs. If a helper fails, check Node/CLI PATH, `copilot login`, model availability, and the CLI version. Do not “fix” a worker failure by copying the complete source back into the main chat.

To disable, use the host's plugin disable/uninstall control; for VS Code local registration set its `chat.pluginLocations` entry to `false`. No fleet files need removal.
