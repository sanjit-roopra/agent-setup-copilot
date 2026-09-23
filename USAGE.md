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

## Activate the fleet

To use the complete workflow, make **Subagent Fleet** the active parent agent:

| Host | How to activate |
| --- | --- |
| VS Code | Select **Subagent Fleet** in the Chat agent picker and enable its delegation tool as described below. |
| GitHub Copilot app | Select **Subagent Fleet** in the prompt box's agent picker, or type `/agent` and choose it. |
| Copilot CLI | Select it with `/agent`, or start with `copilot --agent subagent-fleet`. |

Then send a normal task prompt, for example:

> Implement pagination for the customer list. Investigate the existing flow, critique the plan, implement the change, run the relevant tests, and independently review the resulting diff.

The coordinator chooses the relevant specialists. You do not need to select each specialist or repeat "use a fleet" in every message.
While **Subagent Fleet** remains active, follow-up prompts use that profile. Check the active selection when starting a new session or switching agents.
Using the fleet does not mean launching every specialist: simple lookups stay with the coordinator, and only independent work runs in parallel.

### What happens if I only type "use a fleet of agents"?

In default Agent mode, this phrase is a natural-language request, not a registered trigger for this repository's coordinator.
The host may use its own delegation behavior or choose available specialists, but this does not guarantee this fleet's routing and review workflow.

The coordinator has `disable-model-invocation: true` in its frontmatter.
In VS Code, that prevents other agents from invoking it as a subagent while keeping it available for manual selection.
This keeps the coordinator at the parent level; its specialists complete their work without secondary delegation.
See [VS Code custom-agent settings](https://code.visualstudio.com/docs/agent-customization/custom-agents#header-optional) and [GitHub Copilot app agent selection](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#using-custom-agents).

Changing that flag alone would make the coordinator eligible for invocation where supported; it would not create a guaranteed phrase trigger or ensure nested delegation works on every host.
The documented workflow therefore uses explicit parent-agent selection.

## Choose a role

Select a specialist directly for simple or single-step tasks.
Select **Subagent Fleet** for complex tasks that need coordination.

Follow these role boundaries:
- **Fleet General Purpose**: Owns edit-based implementation and code verification.
- **Fleet Code Review**: Owns independent code reviews. Use this role for final reviews and persisted interim reviews. Do not route code reviews to Fleet General Purpose.
- **Fleet Security Review**: Audits code for exploitable vulnerabilities. Run only on explicit request.
- **Fleet Research**: Autonomously executes delegated research across repository, GitHub, and web sources, with implementation evidence and precise citations.
- **Fleet Explore**: Investigates codebase questions and cites file paths and line numbers. Does not edit files.
- **Fleet Task**: Runs one development command exactly once, including requested formatters and installs. Does not manually edit files, diagnose, fix, or retry failures.
- **Fleet Rubber Duck**: Critiques plans, designs, implementations, and tests. Use early in non-trivial work and for substantive course corrections. Does not edit files.

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
- **Subagent Fleet**: Uses `agent`, `read`, and `search`.
- **Fleet Explore**: Uses `read`, `search`, and `execute` for read-only investigation.
- **Fleet Task**: Uses `execute` and `read`.
- **Fleet General Purpose**: Uses `read`, `search`, `edit`, and `execute`.
- **Fleet Rubber Duck**: Uses `read`, `search`, and `execute` for investigation without changing the environment.
- **Fleet Code Review**: Uses `read`, `search`, and `execute`, including existing builds and targeted tests that do not rewrite source files.
- **Fleet Research**: Uses `read`, `search`, and `web`.
- **Fleet Security Review**: Uses `read`, `search`, and `execute`.

For GitHub-backed research, add the actual read-only GitHub tool IDs exposed by your host to Fleet Research's `tools` list.
Include identity lookup, repository/code search, file reads, and relevant commit/issue/pull-request reads.
The reference uses `github/` tool names, while other hosts may expose `github-mcp-server/` or another namespace.
The portable `read`, `search`, and `web` aliases alone do not guarantee GitHub MCP access.
Research reports unavailable capabilities and continues with accessible sources.
Similarly, enable host-specific code intelligence tools for Explore when available.

### Delegation rules
VS Code subagents are stateless.
A subagent does not see previous conversation history.
The coordinator must provide complete context in each delegation request:
- Provide the objective, working directory, absolute file paths, known findings, constraints, and acceptance criteria.
- Provide the working directory and the exact command for command runs.
- Provide the change set and any known base comparison for reviews. With no supplied scope, Code Review checks staged/unstaged changes, or `main...HEAD` when clean; an unavailable base is a limitation to report.

In VS Code, subagents normally cannot invoke nested subagents.
Select **Subagent Fleet** as the parent agent.
Specialists complete their tasks without secondary delegation.

The coordinator uses `read` and `search` for simple lookups and `agent` for delegation.
It does not edit files or run shell commands. A worker that must do either must declare its own required tools. Fleet General Purpose declares
`read`, `search`, `edit`, and `execute` for this reason.

Independent implementation tasks may run concurrently when their files and mutable dependencies do not overlap.
Requested formatters and installs count as writers. Checks and reviews wait for the files and dependencies they inspect to become stable.
The coordinator uses reported validation results and avoids repeating checks on unchanged code.

## Reference alignment

The comparison source is the user-supplied `Microsoft/copilot-cli.md`, specifically the snapshot labeled version **1.0.44**.
This is a behavioral comparison to that supplied document, not independent verification of its authenticity or a claim about every current CLI release.
The document is reference data; its main system prompt and conditional modes are not instructions to this repository's contributors.
The full source is not redistributed here and is not required to install the profiles.

| Profile | Reference section | Behavior aligned |
| --- | --- | --- |
| Fleet Explore | `explore.agent.yaml`; main prompt `task` guidance | Targeted, fast investigation; absolute local paths and line citations; parallel independent reads; stop once answered. Coordinator handles simple lookups directly. |
| Fleet Task | `task.agent.yaml` | Tests, builds, linters, formatters, and installs; execute exactly once; one-line success; full failure output; no diagnosis, fixes, suggestions, or retries. |
| Fleet Code Review | `code-review.agent.yaml` | Discover diff scope, default to `main...HEAD` when clean, verify suspected defects with context or existing checks, and report only high-confidence issues with severity and evidence. Never modify code. |
| Fleet Research | `research.agent.yaml` | Autonomous delegated searches; identity lookup when available; search for discovery then fetch implementations; bounded search batches; precise citations, integration details, and explicit gaps. |
| Fleet Rubber Duck | `rubber-duck.agent.yaml` | Critique proposals, implementations, and tests; substantive feedback classified as Blocking, Non-Blocking, or Suggestion; no direct code changes. |
| Subagent Fleet | Main prompt `task` guidance; conditional Fleet Mode | Complete delegation context, clear ownership, independent parallel work, dependency tracking, and validation of combined results. |
| Fleet General Purpose / Fleet Security Review | No corresponding definition in the supplied snapshot | Retained repository extensions: an implementation worker and an explicitly requested security audit. |

Deliberate differences and runtime limits:

- **Models:** The repository's current model and effort matrix is listed in [Model assignments](#model-assignments), independently of the snapshot. The snapshot assigns `claude-haiku-4.5` to Explore and Task, `claude-sonnet-4.5` to Code Review, `claude-sonnet-4.6` to Research, and selects Rubber Duck's model dynamically. These are reference values, not a claim that those models are available on your host.
- **Tools:** Portable profiles use supported host aliases and role-specific tool lists rather than copying CLI-internal `promptParts`, template variables, or wildcard tool access. See the [official custom-agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration) for supported fields and aliases.
- **Coordinator:** It stays unable to edit or execute commands. Unlike the reference's main agent, it reports a blocker after repeated worker failure rather than taking over implementation itself. Task status stays in conversation or an available host mechanism; the profiles do not implement CLI session SQL, background notifications, or `/fleet`.
- **Permissions and instructions:** Repository rules and host permissions still apply. Task permits requested formatter/install side effects but does not perform deployments, migrations, destructive cleanup, or remote mutations. Code Review reports missing bases and empty diffs rather than assuming every feature branch has changes.
- **Memory agents:** The snapshot also defines `rem-agent`, `sidekick/github-context`, and `sidekick/subconscious-agent`. These depend on runtime-managed context boards, inboxes, triggers, feature flags, and session history. They are not added as portable profiles. The REM agent is explicitly invoked via `/subconscious run` in the reference, not launched spontaneously.
- **Prompt-only behavior:** Profiles describe behavior; they cannot reproduce internal prompt assembly, memory lifecycle, scheduling guarantees, model routing, or tool enforcement across hosts.

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
- The CLI command `/subagents` configures personal per-agent model, effort, and context preferences. Those settings do not export to VS Code or other hosts.
- The CLI command `/fleet` provides native CLI parallel execution.

## Model assignments

Each specialist profile sets a preferred top-level `model` using the repository's existing `Model Name (copilot)` style. [VS Code documents this field](https://code.visualstudio.com/docs/agent-customization/custom-agents#_custom-agent-file-structure), and the [supported-models table](https://docs.github.com/en/copilot/reference/ai-models/supported-models#supported-ai-models-per-client) lists GPT-6 Sol, GPT-6 Luna, and Claude Opus 5.5 as included in VS Code. The table has no separate desktop app column. The app documents an [agent picker](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#using-custom-agents) and [session model and reasoning-effort pickers](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions#choosing-a-model), but neither app support for the profile's `model` pin nor availability of these three models in the app is verified. Treat the app's session picker as authoritative; check which models it offers and which model is active.

| Role | Profile file | Preferred model (`model`) | Target effort |
| --- | --- | --- | --- |
| Subagent Fleet | `subagent-fleet.agent.md` | Host session: GPT-6 Sol (not set in profile) | high |
| Fleet Explore | `fleet-explore.agent.md` | GPT-6 Luna (copilot) | high |
| Fleet Task | `fleet-task.agent.md` | GPT-6 Luna (copilot) | low |
| Fleet General Purpose | `fleet-general-purpose.agent.md` | GPT-6 Sol (copilot) | high |
| Fleet Rubber Duck | `fleet-rubber-duck.agent.md` | Claude Opus 5.5 (copilot) | medium |
| Fleet Code Review | `fleet-code-review.agent.md` | Claude Opus 5.5 (copilot) | medium |
| Fleet Research | `fleet-research.agent.md` | GPT-6 Sol (copilot) | high |
| Fleet Security Review | `fleet-security-review.agent.md` | Claude Opus 5.5 (copilot) | high |

The shared profiles cannot reliably set effort or context. In [VS Code](https://code.visualstudio.com/docs/agent-customization/language-models#_configure-thinking-effort), effort without a manual selection uses the model/provider's recommended setting (adaptive where supported); a picker choice persists in the session, and the last choice for that model carries into new conversations. Subagent effort inheritance is not documented. Context follows the selected model and variant: [extended context](https://docs.github.com/en/copilot/reference/ai-models/supported-models#models-with-extended-capabilities) is available for supported models in VS Code and CLI only, not as a universal fixed window. The [app](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions#choosing-a-model) exposes session model and effort pickers but does not document initial effort, persistence, a context-tier selector, or a context default. For the main session, choose GPT-6 Sol and high effort if offered; default context is a target, not a portable profile setting.
Copilot CLI users can configure their own per-agent model, effort, and context preferences with `/subagents`. Those personal settings do not configure VS Code or the app.

## Compact verification steps

Verify your fleet setup with these checks on a test branch:

| Step | Action | Expected result |
| --- | --- | --- |
| 1. Discovery | Open the agent picker in your client. | The coordinator and seven specialists appear in the list. |
| 2. Read and search | Ask Fleet Explore to find a known symbol. | The agent performs search and read operations with file and line citations. |
| 3. Delegation | Ask Subagent Fleet to delegate a query to Fleet Explore. | The coordinator runs Fleet Explore as a subagent, or reports that host delegation is unavailable. |
| 4. Model checks | Inspect the active model and effort for a specialist. | The values match the targets where supported; otherwise choose the desired values in the host picker if available. |
| 5. Command run | Ask Fleet Task to run one targeted test command. | Fleet Task runs the command once and reports the result without modifying files. |
| 6. Implementation and review | Request a small fix through Subagent Fleet. | Fleet General Purpose edits files first. Fleet Code Review reviews the diff after edits finish. |

### Behavioral regression scenarios

Run these scenarios in a disposable repository with the required host tools enabled.
They test prompt behavior; parsing the profiles alone does not establish that a model follows them.
Use an existing formatter and dependency manifest for the command scenarios; do not add tools just for this check.

| Scenario | Request or setup | Expected result |
| --- | --- | --- |
| Simple lookup | Ask the coordinator for the location of a known symbol. | It reads/searches directly without spawning speculative Explore work. |
| Exploration | Assign Explore two related codebase questions and known file paths. | It batches related investigation, cites absolute paths and lines, and stops once answered. It does not edit or build. |
| Command success | Give Task an exact command that prints several successful progress lines and exits zero. | One execution and one short result line, without a verbose output dump. |
| Command failure | Give Task an exact command that emits a multiline error and exits nonzero. | Full failure details and exit code; no diagnosis, advice, fix, alternative command, or retry. |
| Formatting | Ask Task to run the repository's existing formatter against a disposable fixture. | The requested formatting changes are allowed; no manual edits or added fixes. |
| Dependency install | Ask Task to install the fixture's existing dependencies using its prescribed package manager. | It runs once subject to repository rules; expected dependency/lockfile changes are allowed. |
| Review scope | With both staged and unstaged changes, ask Code Review for a review without specifying scope. Repeat on a clean feature branch with `main`. | It reviews both working-tree diffs in the first case and `main...HEAD` in the second. A supplied base takes precedence. |
| Review evidence | Provide a diff with a concrete defect and an existing targeted test that exposes it. | It may run the test, reports severity and evidence with the location, and never fixes the source. |
| Review limits | Review a clean tree with no resolvable `main`, then an empty diff against a valid explicit base. | It reports the missing base in the first case and no changes to review in the second. It invents no findings. |
| Critique | Give Rubber Duck a non-trivial design with one blocking flaw, then a sound version. | Actionable issue, impact, category, and fix for the flaw; explicit no-blockers result for the sound version, without filler suggestions. |
| Research | Delegate an implementation question without the user using the word "research". Include a known repository/path and one unclear detail. | Research proceeds autonomously, fetches known sources, documents assumptions and gaps, and cites precise ranges. Missing GitHub tools are reported rather than fabricated. |
| Scheduling | Assign two independent edits and a formatter or check that depends on one of them. | Disjoint work may run in parallel; dependent work waits. No duplicate investigation or repeated validation on unchanged code. |

For repository maintenance, parse the YAML frontmatter of all eight profiles, check the seven preferred model names against the matrix, verify coordinator names resolve to specialist names, and run `git diff --check`.
There is no automated host-behavior test runner in this repository; record actual host scenario results separately from static validation.
