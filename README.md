# Reusable Subagent Fleet for GitHub Copilot

This repository provides a reusable fleet of custom agent profiles for GitHub Copilot.
The fleet brings the role separation of GitHub Copilot CLI `/subagents` workflows to other Copilot clients, especially VS Code.

This project does not add the `/subagents` CLI command to other clients.
It does not transfer CLI settings between clients.
It does not make different Copilot hosts behave identically.

Read [USAGE.md](USAGE.md) for installation procedures and workflow details.
See [strict routing](docs/STRICT-ROUTING.md) for executable cost guards and
[model costs](docs/MODEL-COSTS.md) for the dated price comparison.
Sol now handles small tasks directly and delegates selectively. See the
[measured comparison and limitations](docs/SELECTIVE-FLEET-RESULTS.md).

For lower cost on routine work, select **Economy** after installation, or run
`copilot --agent economy` with the CLI installation. It uses Luna directly for
questions, edits and checks. Read [the cost-saving workflow](docs/ECONOMY.md)
for measured results and when to use a stronger model.

For a strong main model with Shunt-style cheap bulk reading and boilerplate generation,
see the separate [Shunt Copilot plugin](shunt-copilot/README.md). It has its own
CLI, VS Code and Copilot app installation instructions and validation status;
it does not require selecting the Subagent Fleet coordinator. The host table below
describes the fleet profiles, not that plugin.

## Quick start for VS Code

Follow these steps to use the fleet in VS Code:

1. Run `node scripts/install.mjs --host vscode --dest /path/to/your-repository` (Node.js 20+).
2. Enable `chat.useCustomAgentHooks` and keep `chat.subagents.allowInvocationsFromSubagents` disabled.
3. Add `.fleet-review-*/` to that repository's `.gitignore`.
4. Open your repository in VS Code.
5. Open GitHub Copilot Chat.
6. Select **Subagent Fleet** in the agent picker.
7. In Chat customizations, enable the `agent/runSubagent` tool for the coordinator.

For a simple task, select a specialist profile directly in Chat.

## Fleet roles

The repository provides one coordinator, seven specialists and a standalone Economy profile in `.github/agents/*.agent.md`.

| Profile | Type | Responsibilities |
| --- | --- | --- |
| Economy | Standalone | Completes routine questions, edits and checks directly on Luna; reports a focused handoff when blocked. |
| Subagent Fleet | Coordinator | Handles small tasks directly on Sol; delegates substantial bounded work and integrates findings. |
| Fleet Explore | Specialist | Performs focused, read-only codebase investigations with file and line citations. |
| Fleet Task | Specialist | Runs one build, test, or check-only lint command without editing source files. |
| Fleet General Purpose | Specialist | Owns edit-based implementation work and validates code changes. |
| Fleet Rubber Duck | Specialist | Critiques a proposed plan or design before implementation starts. |
| Fleet Code Review | Specialist | Reviews assigned code changes for high-confidence defects. Owns final reviews and persisted interim reviews. |
| Fleet Research | Specialist | Researches questions with citations from repository, GitHub, and web sources. Runs only on explicit request. |
| Fleet Security Review | Specialist | Audits assigned code changes for exploitable vulnerabilities. Runs only on explicit request. |

All profiles specify a pinned model. Exploration and command execution use Luna;
implementation stays on Gemini Flash. Stronger review pins are retained.
The coordinator and expensive local reviewers have scoped tool guards in VS Code.
Cheap workers retain full task context, avoiding recursive read blocking.
See [Model assignments](USAGE.md#model-assignments) in USAGE.md for the full list.

## Host compatibility and limits

Copilot hosts control permissions, model availability, tool access, and process concurrency.
A prompt and a `tools` list do not form a security sandbox.

| Host | Support level | Usage notes |
| --- | --- | --- |
| VS Code | Supported | Select **Subagent Fleet** as the parent agent. Enable the `agent/runSubagent` tool. Scoped read guards require `chat.useCustomAgentHooks` (Preview). Keep nested delegation disabled. |
| Copilot CLI | Supported | Install the CLI variant for raw model IDs and `modelPolicy: required`. Dispatch guards apply; scoped read guards are VS Code-only. |
| GitHub Copilot Desktop | Profiles only | Strict hook enforcement has not been verified. |
| GitHub.com Cloud Agent | Profiles only | Strict enforcement is not claimed. Select custom agents for cloud tasks. Tool aliases include `read`, `search`, `edit`, `execute`, and `agent`. The `web` alias is not applicable to cloud agent. The VS Code `agents` list is not an authorization boundary. |
| JetBrains, Eclipse, Xcode | Preview | Select specialists directly. Use the coordinator only if your host environment supports subagent delegation. |

## Official sources

- [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [Create custom agents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [Custom agents in VS Code](https://code.visualstudio.com/docs/agent-customization/custom-agents)
- [Subagents in VS Code](https://code.visualstudio.com/docs/agents/run/subagents)
- [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Customize the GitHub Copilot app](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
- [Copilot in JetBrains IDEs](https://docs.github.com/en/copilot/concepts/agents/copilot-in-jetbrains)

## Check the implementation

```bash
node --test tests/*.test.mjs
```

Local tests verify hook decisions and installation. Complete the documented live
Copilot smoke checks before rollout. Local guards do not replace billing limits.
