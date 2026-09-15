# Reusable Subagent Fleet for GitHub Copilot

This repository provides a reusable fleet of custom agent profiles for GitHub Copilot.
The fleet brings the role separation of GitHub Copilot CLI `/subagents` workflows to other Copilot clients, especially VS Code.

This project does not add the `/subagents` CLI command to other clients.
It does not transfer CLI settings between clients.
It does not make different Copilot hosts behave identically.

Read [USAGE.md](USAGE.md) for installation procedures, model assignments, and workflow details.

## Quick start for VS Code

Follow these steps to use the fleet in VS Code:

1. Copy the `.github/agents/*.agent.md` files to your repository at `.github/agents/`.
2. Open your repository in VS Code.
3. Open GitHub Copilot Chat.
4. Select **Subagent Fleet** in the agent picker.
5. In Chat customizations, enable the `agent/runSubagent` tool for the coordinator.

For a simple task, select a specialist profile directly in Chat.

## Fleet roles

The fleet provides one coordinator and seven specialists in `.github/agents/*.agent.md`.

| Profile | Type | Responsibilities |
| --- | --- | --- |
| Subagent Fleet | Coordinator | Coordinates specialists. Sends full task context. Combines returned findings. |
| Fleet Explore | Specialist | Performs focused, read-only codebase investigations with file and line citations. |
| Fleet Task | Specialist | Runs one build, test, or check-only lint command without editing source files. |
| Fleet General Purpose | Specialist | Owns edit-based implementation work and validates code changes. |
| Fleet Rubber Duck | Specialist | Critiques a proposed plan or design before implementation starts. |
| Fleet Code Review | Specialist | Reviews assigned code changes for high-confidence defects. Owns final reviews and persisted interim reviews. |
| Fleet Research | Specialist | Researches questions with citations from repository, GitHub, and web sources. Runs only on explicit request. |
| Fleet Security Review | Specialist | Audits assigned code changes for exploitable vulnerabilities. Runs only on explicit request. |

Each specialist profile specifies a pinned model.
See [Model assignments](USAGE.md#model-assignments) in USAGE.md for the full list.

## Host compatibility and limits

Copilot hosts control permissions, model availability, tool access, and process concurrency.
A prompt and a `tools` list do not form a security sandbox.

| Host | Support level | Usage notes |
| --- | --- | --- |
| VS Code | Supported | Select **Subagent Fleet** as the parent agent. Enable the `agent/runSubagent` tool. Subagents are stateless and cannot invoke nested subagents. |
| Copilot CLI | Supported | Select profiles with `/agent` or `--agent`. CLI `/subagents` model settings do not export to other hosts. |
| GitHub Copilot Desktop | Supported | Select profiles in the agent picker or use `/agent`. |
| GitHub.com Cloud Agent | Supported | Select custom agents for cloud tasks. Tool aliases include `read`, `search`, `edit`, `execute`, and `agent`. The `web` alias is not applicable to cloud agent. The VS Code `agents` list is not an authorization boundary. |
| JetBrains, Eclipse, Xcode | Preview | Select specialists directly. Use the coordinator only if your host environment supports subagent delegation. |

## Official sources

- [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [Create custom agents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [Custom agents in VS Code](https://code.visualstudio.com/docs/agent-customization/custom-agents)
- [Subagents in VS Code](https://code.visualstudio.com/docs/agents/run/subagents)
- [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [Customize the GitHub Copilot app](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
- [Copilot in JetBrains IDEs](https://docs.github.com/en/copilot/concepts/agents/copilot-in-jetbrains)
