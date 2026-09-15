# Share a subagent fleet with your team

This setup brings CLI-style specialist roles to Copilot custom-agent clients.
It shares agent files, not the CLI's `/subagents` command or settings.
See the [client compatibility table](README.md#where-it-works) before installing.

A custom agent defines a role, instructions, and available tools. On clients
with delegation, another agent can run it as a subagent in a separate context.
For small tasks, select a specialist directly and skip the coordinator.

## Install without replacing project instructions

From this directory, copy only the agent profiles. Replace the example
destination with your repository path:

```bash
mkdir -p /path/to/your-repository/.github/agents
cp -i .github/agents/*.agent.md /path/to/your-repository/.github/agents/
```

`cp -i` asks before overwriting an existing profile. Review any name collisions.
Do not replace your project's entire `.github` directory.

Keep your existing `AGENTS.md` and `.github/copilot-instructions.md`. Merge any
useful starter rules from this setup. Add your project's language, package tool,
and test commands if they are not already documented.

For GitHub.com's agent picker, commit, push, and merge the profiles into the
default branch. For local clients, open the project containing the files.
Reload the client if the profiles are not listed; the CLI creation guide
specifically requires a restart after adding profiles.

## Choose a client

### VS Code

Install GitHub Copilot and sign in. Open Chat and select **Subagent Fleet** in
the agent dropdown.

Use **Chat: Open Customizations** to confirm that the coordinator and seven
specialists loaded. Make sure `agent/runSubagent` is enabled. The coordinator
has only the `agent` tool; its workers have their own tool selections.

Select the coordinator as the main agent, not as another agent's worker.
Nested subagents are disabled by default in VS Code, and this fleet does not
require enabling them.

### GitHub Copilot desktop app

Open the project and use the agent picker or `/agent` to select a loaded
profile. Start with a single specialist, then try **Subagent Fleet**.

The app also documents `/fleet` for parallel work within an active session.
That is a native feature, separate from selecting this custom coordinator.
The app's published command list does not currently include `/subagents`;
use its model controls and only settings that the installed app supports.

An app session may use a separate worktree. Ensure the profiles are present
in that session's checkout, not just in another local working directory.

### GitHub.com

Select the repository and custom agent in the agents panel or when assigning a
task. This is Copilot cloud agent, not an ordinary Copilot Chat conversation.

GitHub documents an `agent` tool alias for delegation, but not VS Code's
`agents` allowlist contract. The coordinator prompt names the intended workers;
do not treat that prompt as an enforced allowlist.

### JetBrains, Eclipse, and Xcode

Use a version of the Copilot integration that supports custom agents. This
feature is in public preview. Select a specialist in its agent picker first.

Try the coordinator only if your integration exposes custom-agent delegation.
If not, select the implementation, task, and review specialists yourself, passing
the previous result into each request. A profile cannot add a missing host tool.

In JetBrains, the Copilot plugin, AI Assistant/ACP, and the integrated terminal
are different entry points. Running the CLI in a terminal gives CLI behavior,
not evidence that the IDE's chat has the same features.

### Copilot CLI

Use `/agent` to select these custom profiles. For a small read-only question:

```bash
copilot --agent fleet-explore --prompt "Explain the agent files in this project."
```

The command-line agent ID is the filename without `.agent.md`. The displayed
name, such as **Fleet Explore**, is used in the VS Code coordinator allowlist.
Keep those names in sync when renaming profiles.

Use `/subagents` to configure CLI default and per-agent model preferences,
including supported effort and context settings. Use `/fleet` for native
parallel orchestration. Neither command exports those preferences to IDEs.
Built-in roles and these `fleet-` profiles are separate agents.

## Choose models

All seven specialists include a `model` pin. These are the current rollout
defaults: lower-cost models handle exploration, command output, and
implementation, while dedicated models handle critique, reviews, and research.
Only the coordinator uses the host/session model.

Keep these assignments when deploying the fleet. Model changes should be an
explicit team decision, not an automatic portability workaround.

| Role | Pinned model |
| --- | --- |
| Fleet Explore | Gemini 3.8 Flash |
| Fleet Task | Gemini 3.8 Flash |
| Fleet General Purpose | Gemini 3.8 Flash |
| Fleet Rubber Duck | Claude Opus 5 |
| Fleet Code Review | GPT-5.6 Sol |
| Fleet Research | GPT-5.6 Terra |
| Fleet Security Review | GPT-6 Astra |

The profiles already contain their model entries. For example, Fleet Explore
uses:

```yaml
model: "Gemini 3.8 Flash (copilot)"
```

The supplied names use VS Code's display format. If a client requires a
different identifier, map it to the same model rather than removing the pin.
For example, the CLI ID for this model is `gemini-3.8-flash`. If a pinned model
is unavailable to an account, stop and resolve access or agree on a model
change before rolling out to that account.

VS Code accepts a string or a prioritized array in `model`. The CLI documents
its own `model`, `models`, `modelPolicy`, and `reasoningEffort` fields, plus
`/subagents` overrides. These are not one portable schema. Do not copy CLI-only
settings into a shared profile and expect every host to honor them.

In VS Code, an explicit model passed by the caller takes priority over the
profile, which takes priority over the main model. A subagent cannot exceed
the main model's cost tier. Choose a main model that permits your intended
workers. Do not apply that VS Code rule to every Copilot client.

The coordinator is instructed not to override specialist pins. Check for
conflicting CLI `/subagents` settings and explicit per-call overrides. Where
strict CLI enforcement is needed, its `modelPolicy: "required"` can reject
substitution, but that is a CLI-specific control, not a cross-client guarantee.

For cloud agent and other clients, use their documented model controls and
inspect the actual selected model. Loading a profile is not proof that its
model pin was honored. A client that ignores or silently replaces a pin does
not meet this rollout's model policy until that behavior is resolved.

## Write a useful request

Include the goal, file paths, constraints, and acceptance criteria. For a
command, give the exact command and working directory. For a review, identify
the change set and comparison base.

```text
The retry helper in src/client/retry.py drops the last error.
Fix it and add a unit test. From the repository root, run
pytest tests/client/test_retry.py. Review only the resulting changes.
Do not change the public API.
```

The coordinator sends each worker the context it needs. Independent read-only
investigations can run together. Edits to the same files, checks, and reviews
must be ordered so they use the finished result.

An example workflow is:

```text
Fleet General Purpose -> implements the fix and adds tests
Fleet Task            -> runs a required check not already covered
Fleet Code Review     -> reviews the completed change
Fleet General Purpose -> fixes an actionable finding, if any
Fleet Task            -> reruns the affected check
Fleet Code Review     -> reviews the correction
```

Do not require all seven specialists for every task. Research and security
review run only when explicitly requested.

VS Code's documented subagent calls are stateless: corrections need a new call
with the previous findings. The CLI supports agent messaging. Passing complete
context works across both models of execution.

## Check the setup in each client

Use a scratch branch or disposable project for checks that change files. Keep
normal permission prompts enabled.

| Check | Request or action | Expected result |
| --- | --- | --- |
| Discovery | Open the agent picker | Coordinator and seven specialists are listed |
| Read and search | Ask Fleet Explore to find a known symbol | Real search/read tool calls and file/line citations; no edits |
| Delegation | Ask Subagent Fleet to use Fleet Explore on a known file | A visible named subagent call, or an explicit unsupported-host message |
| Model pins | Inspect each specialist's actual model, including host overrides | Actual model matches its pin; unavailable or substituted models block rollout |
| Command success/failure | Give Fleet Task one existing targeted check, then a known failing check in a separate request | One run per request; success summary or exit code and relevant failure output |
| Write and review | Ask for a small fix in the disposable project | Implementation finishes before checks/review; no competing edits |
| Web access | Ask Fleet Research to fetch an official public documentation URL | A real fetch with citations, or a clear tool/access limitation |

A worker claiming it fetched or searched is not enough: inspect the tool calls.
Unknown tool names are ignored by hosts. The profiles include explicit CLI
`grep`, `rg`, `glob`, and `web_fetch` names alongside shared aliases because aliases
alone did not expose those tools in CLI 1.0.83.

If GitHub tools are needed outside cloud agent, configure an approved GitHub
MCP server. Match the tool prefix to the server's actual name. `github/*` is
not an installation step, and may expose write operations on other hosts.

Shell-capable roles are not technically read-only. Enforce permissions in the
client, and use check-only lint commands. Fleet Task permits generated test
caches and build output but rejects source-writing commands, installs,
deployments, and migrations.

## Adapt the roles

Edit a profile's Markdown body to change its behavior. Keep its prompt below
30,000 characters. Add a role by creating a uniquely named `.agent.md` file
and adding its exact display name to the coordinator's `agents` list.

Omitting `tools` enables all available tools, as used by Fleet General Purpose.
Other roles list only their needed capabilities. Preserve direct specialist
selection for clients without delegation. Do not add nested delegation unless
you have a specific need and the host supports it.

See [README.md sources](README.md#sources) for the official client references.
