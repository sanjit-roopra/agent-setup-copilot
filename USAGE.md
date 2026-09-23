# Use the agent fleet

**Start:** Copy the profiles into your repository, then select **Subagent Fleet** in your client's agent picker. [README.md](README.md#pick-a-specialist) shows which specialist to pick for smaller tasks.

## Install the fleet profiles

1. Create the agent folder in your repository:
   ```bash
   mkdir -p /path/to/your-repository/.github/agents
   ```
2. Copy the profiles:
   ```bash
   cp -i .github/agents/*.agent.md /path/to/your-repository/.github/agents/
   ```
3. Open your repository in VS Code or the Copilot app. Select **Subagent Fleet** in the agent picker.

Keep your existing `.github` directory and project instructions. If you need rules from this repository's `AGENTS.md` or `.github/copilot-instructions.md`, merge them into your own files instead of replacing them.

For GitHub.com, commit and push the profiles to your default branch. If they do not appear in a local agent picker, reload your client.

## Activate the fleet

Choose **Subagent Fleet** as the parent agent:

| Host | How to activate |
| --- | --- |
| VS Code | Select **Subagent Fleet** in the Chat agent picker. The `agent` tool is already in its profile. |
| GitHub Copilot app | Select **Subagent Fleet** in the prompt box's agent picker, or type `/agent` and choose it. |
| Copilot CLI | Select it with `/agent`, or start with `copilot --agent subagent-fleet`. |

Send a task, for example:

> Implement pagination for the customer list. Investigate the existing flow, critique the plan, implement the change, run the relevant tests, and independently review the resulting diff.

The coordinator picks only the specialists it needs. Simple lookups stay with the coordinator. While it is selected, follow-up prompts use the same profile; check the picker when you start a new session.

### What happens if I only type "use a fleet of agents"?

No. The phrase does not select this profile. A default agent might delegate work, but it will not reliably follow this fleet's routing rules.

In VS Code, `disable-model-invocation: true` keeps **Subagent Fleet** in the picker but stops other agents from calling it as a subagent. Changing the flag would not make the phrase a trigger or guarantee nested delegation. See [VS Code custom-agent settings](https://code.visualstudio.com/docs/agent-customization/custom-agents#header-optional).

## Choose a role

For one focused task, select a specialist directly. For work that needs several roles, select **Subagent Fleet**. See [the role table](README.md#pick-a-specialist).

Keep the work separate: **Fleet General Purpose** makes changes; **Fleet Code Review** reviews them. Use **Fleet Security Review** only when explicitly asked. **Fleet Task** runs a specified command once and does not fix failures.

## VS Code workflow

### Check the subagent tool

No extra setting is normally needed. The coordinator's `tools: ["agent", "read", "search"]` makes the `agent` tool group available; `agents` lists the specialists it may use. VS Code calls the specific tool `agent/runSubagent`.

If it cannot delegate, select **Subagent Fleet** and type `#agent` in Chat. This shows whether the tool is available. You can also open **Configure Chat** (gear icon) > **Tools**.

The available tools depend on your session target and VS Code version. See [VS Code's subagent guide](https://code.visualstudio.com/docs/agents/run/subagents#_invoke-a-subagent).

### Tools by role

- **Subagent Fleet** uses `agent`, `read`, and `search`; it does not edit or run commands.
- **Fleet General Purpose** uses `read`, `search`, `edit`, and `execute`.
- **Fleet Task** uses `execute` and `read`.
- **Fleet Explore, Rubber Duck, Code Review, and Security Review** use `read`, `search`, and `execute`. Their instructions keep them from editing. Code Review can run existing targeted checks.
- **Fleet Research** uses `read`, `search`, and `web`.

For GitHub-backed research, add your client's read-only GitHub tools to **Fleet Research**. Include identity, code search, file reads, and commit, issue, and PR reads.

Tool names vary by client (`github/`, `github-mcp-server/`, or another prefix). The portable `read`, `search`, and `web` aliases do not grant GitHub MCP access. Research reports missing tools instead of inventing results. Add code intelligence tools to **Fleet Explore** if your client has them.

### Delegation rules
VS Code subagents do not see the parent conversation. Give each one the context it needs:

1. State the goal, working directory, file paths, known findings, limits, and what counts as done.
2. For **Fleet Task**, give the exact command and working directory.
3. For **Fleet Code Review**, give the diff or base branch. Without a scope, it checks staged and unstaged changes, or `main...HEAD` on a clean branch. It reports a missing base rather than guessing.

In VS Code, specialists normally cannot launch more subagents. The coordinator handles simple lookups itself and delegates edits or commands to specialists.

Only run independent edits in parallel when they do not touch the same files or dependencies. Formatters and installs can change files too. Wait for those changes before reviewing or checking them; reuse checks already run on unchanged code.

## Reference alignment

These profiles borrow role boundaries from a user-supplied `Microsoft/copilot-cli.md` snapshot labeled **CLI 1.0.44**. You do not need that file to use the fleet.

This comparison does not verify the snapshot's source or describe every CLI release. Its prompts are reference data, not instructions for this repository.

<details>
<summary>Compare roles and runtime limits</summary>

The comparison is about behavior, not identical tools or model settings.

| Profile | Reference section | Behavior aligned |
| --- | --- | --- |
| Fleet Explore | `explore.agent.yaml`; main prompt `task` guidance | Targeted, fast investigation; absolute local paths and line citations; parallel independent reads; stop once answered. Coordinator handles simple lookups directly. |
| Fleet Task | `task.agent.yaml` | Tests, builds, linters, formatters, and installs; execute exactly once; one-line success; full failure output; no diagnosis, fixes, suggestions, or retries. |
| Fleet Code Review | `code-review.agent.yaml` | Discover diff scope, default to `main...HEAD` when clean, verify suspected defects with context or existing checks, and report only high-confidence issues with severity and evidence. Never modify code. |
| Fleet Research | `research.agent.yaml` | Autonomous delegated searches; identity lookup when available; search for discovery then fetch implementations; bounded search batches; precise citations, integration details, and explicit gaps. |
| Fleet Rubber Duck | `rubber-duck.agent.yaml` | Critique proposals, implementations, and tests; substantive feedback classified as Blocking, Non-Blocking, or Suggestion; no direct code changes. |
| Subagent Fleet | Main prompt `task` guidance; conditional Fleet Mode | Complete delegation context, clear ownership, independent parallel work, dependency tracking, and validation of combined results. |
| Fleet General Purpose / Fleet Security Review | No corresponding definition in the supplied snapshot | Retained repository extensions: an implementation worker and an explicitly requested security audit. |

What differs from the snapshot:

- **Models:** See [Model assignments](#model-assignments) for this repository's choices. The snapshot instead uses `claude-haiku-4.5` for Explore and Task, `claude-sonnet-4.5` for Code Review, `claude-sonnet-4.6` for Research, and a dynamic choice for Rubber Duck. These are reference values, not host availability claims.
- **Tools:** The profiles use [supported tool aliases](https://docs.github.com/en/copilot/reference/custom-agents-configuration), not the CLI's internal `promptParts`, templates, or unrestricted tools.
- **Coordinator:** It cannot edit or run commands. After repeated worker failure, it reports the blocker rather than taking over. It does not implement CLI session SQL, background notifications, or `/fleet`.
- **Permissions:** Repository rules still apply. Task may run requested formatters or installs, but not deployments, migrations, destructive cleanup, or remote changes. Code Review reports missing bases or empty diffs instead of inventing findings.
- **Memory agents:** The snapshot's `rem-agent`, `sidekick/github-context`, and `sidekick/subconscious-agent` need runtime-managed memory, triggers, and session history, so they are not portable profiles. In the snapshot, REM runs only through `/subconscious run`.
- **Host behavior:** Agent instructions cannot guarantee internal prompt assembly, memory, scheduling, model routing, or tool enforcement.

</details>

## Cloud-agent limitations

On GitHub.com cloud agent:
- Supported tool aliases include `read`, `search`, `edit`, `execute`, and `agent`.
- The `github/*` tool namespace is specific to cloud agent.
- The `web` tool alias is currently not applicable to cloud agent.
- The `agents` allowlist in `subagent-fleet.agent.md` is a VS Code configuration. It is not an authorization boundary on cloud agent.
Permissions, models, and available tools still depend on the host. A `tools` list is not a security boundary.

## Optional Copilot CLI usage

<details>
<summary>Run a profile with the CLI</summary>

```bash
copilot --agent fleet-explore --prompt "Find where user authentication is configured."
```

The agent ID is the filename without `.agent.md`. Use `/agent` to switch profiles. `/subagents` sets personal per-agent model, effort, and context preferences; those settings do not carry over to VS Code or the app. `/fleet` enables the CLI's own parallel subagents.

</details>

## Model assignments

**Check the model in your client.** The files set preferred models, but the effort levels below are targets, not settings enforced by the files.

| Role | Profile file | Preferred model (`model`) | Target effort |
| --- | --- | --- | --- |
| Subagent Fleet | `subagent-fleet.agent.md` | Host session: GPT-6 Sol (not set in profile) | high |
| Fleet Explore | `fleet-explore.agent.md` | GPT-6 Luna (copilot) | high |
| Fleet Task | `fleet-task.agent.md` | GPT-6 Luna (copilot) | low |
| Fleet General Purpose | `fleet-general-purpose.agent.md` | GPT-6 Sol (copilot) | high |
| Fleet Research | `fleet-research.agent.md` | GPT-6 Sol (copilot) | high |

| Review role | Profile file | Preferred model (`model`) | Target effort |
| --- | --- | --- | --- |
| Fleet Rubber Duck | `fleet-rubber-duck.agent.md` | Claude Opus 5.5 (copilot) | medium |
| Fleet Code Review | `fleet-code-review.agent.md` | Claude Opus 5.5 (copilot) | medium |
| Fleet Security Review | `fleet-security-review.agent.md` | Claude Opus 5.5 (copilot) | high |

### VS Code

The agent files use the [supported `model` field](https://code.visualstudio.com/docs/agent-customization/custom-agents#_custom-agent-file-structure). [All three models are listed for VS Code](https://docs.github.com/en/copilot/reference/ai-models/supported-models#supported-ai-models-per-client).

Choose [Thinking Effort](https://code.visualstudio.com/docs/agent-customization/language-models#_configure-thinking-effort) in the model picker. Without a manual choice, VS Code uses the model/provider's recommended level (adaptive when supported). It remembers the last choice for that model in new conversations. Subagent effort inheritance is not documented.

### Copilot app

Select the agent, then check the [session model and reasoning-effort pickers](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions#choosing-a-model). GitHub's model table has no separate desktop app column. The app docs do not confirm that it offers these models or applies a profile's `model` value.

### Context

No shared agent-profile field sets it. The window depends on the model and variant. [Extended context](https://docs.github.com/en/copilot/reference/ai-models/supported-models#models-with-extended-capabilities) is documented for supported models in VS Code and CLI, not the desktop app. The app does not document a context-tier picker or default.

For the main session, select GPT-6 Sol and high effort if your client offers them. Default context is a target, not a shared profile setting.

## Check your setup

On a test branch:

1. Open the agent picker. You should see **Subagent Fleet** and seven specialists.
2. Ask **Fleet Explore** to find a known function. Expect a file path and line number.
3. Ask **Subagent Fleet** to send that lookup to **Fleet Explore**. Expect a subagent result or an explicit notice that delegation is unavailable.
4. Check the specialist's active model and effort. Use your client's picker if the target is not active or available.
5. Ask **Subagent Fleet** for a small fix and review. **Fleet General Purpose** should edit first; **Fleet Code Review** should review the resulting diff.

### Behavioral regression scenarios

<details>
<summary>More checks for agent behavior</summary>

Use a disposable repository with the needed client tools. These checks test what the agents do, not just whether the files parse. Use an existing formatter and dependency manifest; do not add tools just for these checks.

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

</details>

For repository maintenance, parse all eight YAML profiles, check the seven preferred models against the table, and confirm that the coordinator names existing specialists. Run `git diff --check`.

There is no automated test runner for client behavior. Record those results separately.

**Next:** [Check the fleet on a test branch](#check-your-setup).
