# Subagent Fleet for GitHub Copilot

**Start in VS Code:** Copy the agent profiles, select **Subagent Fleet**, and give it a task. It will choose which specialists to use.

The profiles work in VS Code and other Copilot clients, but each client controls its own models, tools, and permissions. They do not add CLI `/subagents` to VS Code or carry CLI settings into other clients.

## Start in VS Code

1. Copy the `.github/agents/*.agent.md` files to your repository at `.github/agents/`.
2. Open the repository in VS Code and open GitHub Copilot Chat.
3. Select **Subagent Fleet** in the agent picker.
4. Send your task. For example: “Find the cause of the failing test, fix it, and review the change.”

For one small task, select the relevant specialist instead. The coordinator already has the `agent` tool; there is no extra switch to enable.

See [USAGE.md](USAGE.md#install-the-fleet-profiles) for install commands and setup in other clients.

## Select the coordinator

Choose **Subagent Fleet** in the agent picker. In the Copilot app, you can also type `/agent` to select it.

Typing “use a fleet of agents” in the default agent does not select this coordinator. Another agent might delegate, but it will not reliably follow this fleet's rules.

Select **Subagent Fleet** as the parent instead. See [Activate the fleet](USAGE.md#activate-the-fleet).

## Pick a specialist

**For code and checks:**

| Need | Agent |
| --- | --- |
| Coordinate several tasks | **Subagent Fleet**: delegates and combines results; does not edit or run commands. |
| Change code | **Fleet General Purpose**: implements and checks changes. |
| Find code | **Fleet Explore**: reads and searches; cites files and lines. |
| Run a command | **Fleet Task**: runs it once; reports success briefly or the full error. |

**For second opinions:**

| Need | Agent |
| --- | --- |
| Check a plan | **Fleet Rubber Duck**: critiques plans, code, or tests without editing. |
| Review changes | **Fleet Code Review**: finds high-confidence defects without editing. |
| Research sources | **Fleet Research**: investigates and cites what it found. |
| Review security | **Fleet Security Review**: looks for exploitable issues, only when you ask. |

Each specialist names a preferred model and reasoning effort. Effort and context can differ by client. See [Model assignments](USAGE.md#model-assignments).

## Where it works

| Client | What to do |
| --- | --- |
| VS Code | Select **Subagent Fleet** as the parent. VS Code 1.136+ reads the profiles' reasoning effort. Subagents do not normally delegate again. |
| Copilot app | Select the agent in the picker or with `/agent`. Check its model and effort pickers; it might not apply the profile's model choice. |
| Copilot CLI | Use `/agent` or `--agent`. `/subagents` settings stay in the CLI. |
| GitHub.com cloud agent | Custom agents work, but available tools differ. The VS Code `agents` list is not a security boundary. |
| JetBrains, Eclipse, Xcode (preview) | Select a specialist directly unless your client supports delegation. |

For the CLI's **built-in** subagents (not these fleet profiles), see the
[downloadable model settings](copilot-cli/README.md).

**Limits:** Your client controls models, permissions, tools, and concurrency. Agent instructions and tool lists are not a security sandbox.

See [cloud-agent limits](USAGE.md#cloud-agent-limitations) and [differences from the CLI reference](USAGE.md#reference-alignment) in the usage guide.

## Official sources

- VS Code: [Custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents), [subagents](https://code.visualstudio.com/docs/agents/run/subagents), and [thinking effort](https://code.visualstudio.com/docs/agent-customization/language-models).
- Copilot app: [Custom agents](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app) and [model selection](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions#choosing-a-model).
- GitHub: [Agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration) and [cloud agent setup](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents).
- Other clients: [CLI commands](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) and [JetBrains support](https://docs.github.com/en/copilot/concepts/agents/copilot-in-jetbrains).

**Next:** [Copy the profiles into your repository](USAGE.md#install-the-fleet-profiles).
