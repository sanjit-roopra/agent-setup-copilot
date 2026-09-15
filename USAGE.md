# Fleet Usage Guide

This guide explains how to install, configure, and use the subagent fleet.
Read [README.md](README.md) for the fleet overview and role summaries.

## Install the fleet profiles

To install the agent profiles into your repository:

1. Create the destination directory:
   ```bash
   mkdir -p /path/to/your-repository/.github/agents
   ```
2. Copy the agent profiles from this repository:
   ```bash
   cp -i .github/agents/*.agent.md /path/to/your-repository/.github/agents/
   ```

Do not overwrite your project's existing `.github` directory.
Do not replace your existing project instructions in `AGENTS.md` or `.github/copilot-instructions.md`.
Merge relevant project rules into your existing files instead.

To use profiles on GitHub.com, commit and push the files to your default branch.
To use profiles locally, open your repository in your client.
Reload your client if the profiles do not appear in the agent picker.

## Choose a role

Select a specialist directly for simple or single-step tasks.
Select **Subagent Fleet** for complex tasks that need coordination.

Follow these role boundaries:
- **Fleet General Purpose**: Owns edit-based implementation and code verification.
- **Fleet Code Review**: Owns independent code reviews. Use this role for final reviews and persisted interim reviews. Do not route code reviews to Fleet General Purpose.
- **Fleet Security Review**: Audits code for exploitable vulnerabilities. Run only on explicit request.
- **Fleet Research**: Researches topics across repository, GitHub, and web sources. Run only on explicit request.
- **Fleet Explore**: Investigates codebase questions and cites file paths and line numbers. Does not edit files.
- **Fleet Task**: Runs one build, test, or check-only command. Does not edit source files.
- **Fleet Rubber Duck**: Evaluates a plan or design before implementation starts. Does not edit files.

## VS Code workflow

### Configure VS Code tools
In VS Code, custom agent profiles use tool aliases such as `read`, `search`, `web`, `execute`, and `agent`.
VS Code selectable tool IDs can be more specific, such as `agent/runSubagent`, `search/codebase`, and `web/fetch`.

To enable delegation in VS Code:
1. Open GitHub Copilot Chat.
2. Open Chat customizations.
3. Enable the `agent/runSubagent` tool for the coordinator.

Note: `agent/runSubagent` is a VS Code tool setting to enable in the editor interface.
The coordinator profile YAML frontmatter uses the `agent` alias.

### Profile tool configurations
The tool lists in the fleet profiles are intentional:
- **Subagent Fleet**: Uses `agent`.
- **Fleet Explore**: Uses `read` and `search`.
- **Fleet Task**: Uses `execute` and `read`.
- **Fleet General Purpose**: Uses `read`, `search`, `edit`, and `execute`.
- **Fleet Rubber Duck**: Uses `read` and `search`.
- **Fleet Code Review**: Uses `read`, `search`, and `execute`.
- **Fleet Research**: Uses `read`, `search`, and `web`.
- **Fleet Security Review**: Uses `read`, `search`, and `execute`.

### Delegation rules
VS Code subagents are stateless.
A subagent does not see previous conversation history.
The coordinator must provide complete context in each delegation request:
- Provide the objective, file paths, constraints, and acceptance criteria.
- Provide the working directory and the exact command for command runs.
- Provide the change set and base comparison for reviews.

In VS Code, subagents normally cannot invoke nested subagents.
Select **Subagent Fleet** as the parent agent.
Specialists complete their tasks without secondary delegation.

The coordinator has only the `agent` tool. A worker that must edit files or run
commands must declare its own required tools. Fleet General Purpose declares
`read`, `search`, `edit`, and `execute` for this reason.

## Cloud-agent limitations

When you use GitHub Copilot cloud agent:
- Supported tool aliases include `read`, `search`, `edit`, `execute`, and `agent`.
- The `github/*` tool namespace is specific to cloud agent.
- The `web` tool alias is currently not applicable to cloud agent.
- The `agents` allowlist in `subagent-fleet.agent.md` is a VS Code configuration. It is not an authorization boundary on cloud agent.
- Hosts control permissions, models, tool availability, and concurrency. A prompt and a `tools` list do not form a security sandbox.

## Optional Copilot CLI usage

You can run the custom agent profiles in the Copilot CLI.

To run a specialist with the CLI:
```bash
copilot --agent fleet-explore --prompt "Find where user authentication is configured."
```

CLI usage notes:
- The agent ID in the CLI is the profile filename without `.agent.md`.
- Use `/agent` to switch between custom profiles.
- The CLI command `/subagents` configures CLI model preferences. Those settings do not export to VS Code or other hosts.
- The CLI command `/fleet` provides native CLI parallel execution.

## Model assignments

Each specialist profile specifies a pinned model.
These pins reflect repository preferences for role-specific capability and cost control.
Hosts control actual model availability and can override these preferences.
Keep the existing pins in the profiles.

| Role | Profile file | Pinned model |
| --- | --- | --- |
| Subagent Fleet | `subagent-fleet.agent.md` | Host or session default |
| Fleet Explore | `fleet-explore.agent.md` | Gemini 3.8 Flash |
| Fleet Task | `fleet-task.agent.md` | Gemini 3.8 Flash |
| Fleet General Purpose | `fleet-general-purpose.agent.md` | Gemini 3.8 Flash |
| Fleet Rubber Duck | `fleet-rubber-duck.agent.md` | Claude Opus 5 |
| Fleet Code Review | `fleet-code-review.agent.md` | GPT-5.6 Sol |
| Fleet Research | `fleet-research.agent.md` | GPT-5.6 Terra |
| Fleet Security Review | `fleet-security-review.agent.md` | GPT-6 Astra |

If a pinned model is unavailable on your host, resolve account access or adjust host model mappings before deployment.

## Compact verification steps

Verify your fleet setup with these checks on a test branch:

| Step | Action | Expected result |
| --- | --- | --- |
| 1. Discovery | Open the agent picker in your client. | The coordinator and seven specialists appear in the list. |
| 2. Read and search | Ask Fleet Explore to find a known symbol. | The agent performs search and read operations with file and line citations. |
| 3. Delegation | Ask Subagent Fleet to delegate a query to Fleet Explore. | The coordinator runs Fleet Explore as a subagent, or reports that host delegation is unavailable. |
| 4. Model checks | Inspect the active model for a specialist. | The active model matches the pinned model, or the host shows a configured override. |
| 5. Command run | Ask Fleet Task to run one targeted test command. | Fleet Task runs the command once and reports the result without modifying files. |
| 6. Implementation and review | Request a small fix through Subagent Fleet. | Fleet General Purpose edits files first. Fleet Code Review reviews the diff after edits finish. |
