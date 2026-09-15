# Subagent fleet for Copilot custom agents

One coordinator and seven specialists for GitHub Copilot. This standalone set
shares the role split of Copilot CLI's built-in subagents with other Copilot
clients through `.github/agents/*.agent.md` files.

It does not add the CLI's `/subagents` command to an IDE or synchronize CLI
settings. Custom profiles share roles, prompts, and tool selections. The client
still controls model availability, delegation, permissions, and concurrency.

Read [USAGE.md](USAGE.md) for installation, model choices, and example requests.

## Where it works

The following describes documented capabilities, not an end-to-end test of
every client. Sources were reviewed on September 15, 2026.

| Client | Custom profiles | How to use this fleet |
| --- | --- | --- |
| VS Code | Supported, including custom subagent orchestration | Select **Subagent Fleet** in Chat. Enable the `agent/runSubagent` tool. The coordinator's `agents` allowlist is supported. |
| Copilot CLI | Supported alongside built-in subagents | Use `/agent` for these profiles. Use `/subagents` for CLI model preferences and `/fleet` for native parallel execution. |
| GitHub Copilot desktop app | Custom agent picker, `/agent`, and `/fleet` are documented | Open the project and select a loaded profile. The app is CLI-based, but its UI and supported settings are not identical to the CLI. |
| GitHub.com Copilot cloud agent | Custom profiles and the `agent` tool alias are documented | Publish profiles, then select an agent for a cloud task. Do not rely on VS Code's `agents` allowlist being enforced here. |
| JetBrains Copilot plugin | Custom agents are in public preview | Select a specialist directly first. Use the coordinator only if the installed plugin/harness exposes custom-agent delegation. |
| Eclipse and Xcode | Custom agents are in public preview | Use the same direct-specialist fallback. Full fleet orchestration is not established by profile support alone. |

The GitHub Copilot app is a desktop client, not GitHub.com and not GitHub
Desktop. Its documented `/fleet` command runs parallel agents in an active
session; its command reference does not currently list `/subagents`.

JetBrains has several entry points: the Copilot plugin, Copilot through AI
Assistant/ACP, and the CLI in a terminal. Do not assume they expose the same
custom-agent controls.

These distinctions come from the [configuration reference][config],
[VS Code subagent guide][subagents], [CLI reference][cli],
[app customization guide][app], [app commands][app-commands], and
[JetBrains overview][jetbrains].

## Install

Copy the eight files in `.github/agents/` into the same directory at the root of
your project. Preserve existing agents with the same filenames unless you
intend to replace them.

Do not copy the whole `.github` directory over an existing repository.
`AGENTS.md` and `.github/copilot-instructions.md` are starter instructions:
merge useful rules into your existing instructions rather than overwriting them.
They are not required to discover the agent profiles.

For GitHub.com's agent picker, commit and push the profiles and merge them into
the default branch, as described in the [creation guide][create]. GitHub also
versions profiles by commit and branch for task execution. Local editor
discovery does not require publishing the files.

## Roles

| Agent | Purpose |
| --- | --- |
| Subagent Fleet | Coordinate specialists and combine their results |
| Fleet Explore | Focused read-only codebase investigation |
| Fleet Task | One test, build, or check-only lint command |
| Fleet General Purpose | Implementation and verification |
| Fleet Rubber Duck | Independent critique of a plan or design |
| Fleet Code Review | High-confidence defects in an assigned change set |
| Fleet Research | Cited research, when explicitly requested |
| Fleet Security Review | Exploitable vulnerability review, when explicitly requested |

All seven specialists pin a model. These pins are the rollout defaults for
cost control and role-specific capability, not optional examples. Only the
coordinator uses the host/session model. See the
[model assignments](USAGE.md#choose-models) before deploying.

Keep the pins when installing this fleet. If a client or account cannot use a
pinned model, report that as a rollout blocker rather than removing the pin or
silently substituting another model. Host overrides and fallback behavior still
need to be checked; a profile alone is not a universal spending limit.

## Orchestration rules

The coordinator gives specialists a complete task, relevant paths, constraints,
and acceptance criteria. It keeps small tasks with one specialist and runs only
independent work in parallel.

Implementations must not edit the same files concurrently. Checks and reviews
wait for edits to finish. The coordinator routes failures back for correction,
does not repeat checks on unchanged results, and reports blockers rather than
claiming success.

This fleet uses one delegation level. Select the coordinator as the main agent;
specialists do not need nested delegation. If delegation is unavailable, the
coordinator reports that limit and names a specialist to select directly.

Prompts guide model behavior; they are not a deterministic workflow engine.

## Portability limits

**Tools:** Profiles use documented aliases such as `read`, `search`, `execute`,
`web`, and `agent`. They also list `grep`, `rg`, `glob`, and `web_fetch` where needed:
in CLI 1.0.83, the restricted research profile exposed neither search nor fetch
tools with only `search` and `web`. Explicit tool names restored those tools.
Other clients ignore tool names they do not recognize.

**Web and GitHub access:** The cloud-agent mapping for `web` is currently not
applicable. This is not a claim that every cloud environment lacks network
access. Research uses whichever permitted sources are actually available and
reports missing access. `github/*` enables tools from a server named `github`;
it does not install that server. Cloud agent provides read-only GitHub tools
by default, scoped to the source repository. Other hosts need their own server
configuration and may use a different name.

**Read-only roles:** Tool lists restrict available capabilities, but shell
access can still write files. `Fleet Task` permits normal build output and test
caches, not source edits or deployments. Reviewers allow only read-only
commands. A GitHub MCP wildcard can include write tools on other hosts. Use
host permissions and read-only credentials where enforcement matters; prompt
instructions are not a sandbox.

**VS Code behavior:** Its documented subagent calls are stateless, and a
requested model cannot exceed the main model's cost tier. These are VS Code
rules, not universal custom-agent rules. The CLI also documents ongoing agent
communication. Always pass complete task context for portability.

**Frontmatter:** Omitting `target` makes profiles eligible for both documented
target environments; it does not guarantee feature parity. `agents` is a
documented VS Code control, not a portable authorization boundary. The
coordinator sets `disable-model-invocation: true` so it is selected explicitly.
Specialists remain both selectable and available for delegation.

## Differences from CLI built-ins

These are original role prompts based on [published responsibilities][builtins],
not copies of internal prompts or the CLI scheduler.

`Fleet Explore` cannot run shell commands. `Fleet Task` does not install
dependencies or run source-writing formatters. `Fleet Rubber Duck` does not
automatically choose a different model family. `Fleet General Purpose` has all
available tools, but is instructed to do its own work rather than delegate.

The `fleet-` filenames keep these custom profiles separate from built-in IDs
such as `explore` and `code-review`. They can coexist in the CLI.

## Sources

- [Custom agents configuration][config]
- [Creating custom agents and publishing them][create]
- [Custom agents in VS Code][vscode]
- [Subagents in VS Code][subagents]
- [Copilot CLI built-in roles][builtins]
- [Copilot CLI commands and custom-agent configuration][cli]
- [Copilot CLI fleet mode][fleet]
- [Customizing the GitHub Copilot app][app]
- [GitHub Copilot app commands][app-commands]
- [Copilot in JetBrains IDEs][jetbrains]

[config]: https://docs.github.com/en/copilot/reference/custom-agents-configuration
[create]: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents
[vscode]: https://code.visualstudio.com/docs/agent-customization/custom-agents
[subagents]: https://code.visualstudio.com/docs/agents/run/subagents
[builtins]: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents
[cli]: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
[fleet]: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/fleet
[app]: https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app
[app-commands]: https://docs.github.com/en/copilot/reference/github-copilot-app-reference/slash-commands
[jetbrains]: https://docs.github.com/en/copilot/concepts/agents/copilot-in-jetbrains
