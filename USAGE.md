# Use the agent fleet

**Start:** Copy the profiles into your repository, then select **Subagent Fleet** in your client's agent picker. [README.md](README.md#pick-a-specialist) shows which specialist to pick for smaller tasks. For Copilot CLI, use the [Copilot CLI settings snippets](copilot-cli/README.md) instead; see [Copilot CLI](#copilot-cli).

## Install the fleet profiles

1. Create the agent folder in your repository:
   ```bash
   mkdir -p /path/to/your-repository/.github/agents
   ```
2. Copy the profiles:
   ```bash
   cp -i .github/agents/*.agent.md /path/to/your-repository/.github/agents/
   ```
3. Optional: for the [budget fleet](#recommended-or-budget), copy the two budget profiles over the recommended ones:
   ```bash
   cp budget/agents/*.agent.md /path/to/your-repository/.github/agents/
   ```
4. Open your repository in VS Code or the Copilot app. Select **Subagent Fleet** in the agent picker.

Keep your existing `.github` directory and project instructions. If you need rules from this repository's `AGENTS.md` or `.github/copilot-instructions.md`, merge them into your own files instead of replacing them.

For GitHub.com, commit and push the profiles to your default branch. If they do not appear in a local agent picker, reload your client.

## Recommended or budget

- **Recommended:** complex or unfamiliar work, where a failed change is expensive.
- **Budget:** routine, well-scoped tasks, where rerunning is cheap.

The fleet comes in two variants, for both the agent profiles and the Copilot CLI. They differ only in the implementation and exploration roles; the coordinator, Task, Research, and the review roles are the same.

| | Recommended | Budget |
| --- | --- | --- |
| Implementation (Fleet General Purpose / `general-purpose`) | Claude Opus 5.5, medium | Claude Sonnet 5.5, medium |
| Implementation: Terminal-Bench 4.0 | 53% | 30% |
| Implementation: index cost | $1,627 (2.7x GPT-6 Sol (high)) | $701 (1.15x GPT-6 Sol (high)) |
| Implementation: time per task | 3.6 min | 2.1 min |
| Exploration (Fleet Explore / `explore`) | Claude Sonnet 5.5, low | GPT-6 Luna, medium |
| Exploration: Terminal-Bench 4.0 | 21% | 3% |
| Exploration: index cost | $544 | $31 |

How to read the costs:

- Each cost row covers one role only. The other six roles cost the same in both variants, so your overall saving depends on how much of your work goes to implementation and exploration.
- The figures are what it cost Artificial Analysis to run its benchmark suite, not a Copilot bill. Compare them as ratios between the variants, not as amounts you will pay.

In more detail, pick **recommended** when:

- changes span several files or modules, or the codebase is unfamiliar to you;
- a failed or half-finished change is expensive, for example because CI is slow or the change is hard to review;
- you want the best chance of getting the change right the first time.

Pick **budget** when:

- most tasks are well-scoped and routine: small fixes, tests, and refactors in code you know;
- you want faster turnaround and review every change anyway;
- cost matters more than first-attempt success, and rerunning a task is cheap.

The budget variant runs implementation on the same model and effort as the coordinator, Claude Sonnet 5.5 (medium). If budget runs keep needing rework on a kind of task, switch that repository back to recommended.

How to install each variant:

| Client | Recommended | Budget |
| --- | --- | --- |
| VS Code, Copilot app, GitHub.com | Copy `.github/agents/*.agent.md` ([Install the fleet profiles](#install-the-fleet-profiles)). | Also copy `budget/agents/*.agent.md` over the recommended profiles ([budget/README.md](budget/README.md#install)). |
| Copilot CLI | Merge [`copilot-cli/subagents.json`](copilot-cli/subagents.json). | Merge [`copilot-cli/subagents-budget.json`](copilot-cli/subagents-budget.json). |

To switch a repository back to recommended, see [budget/README.md](budget/README.md#install). In the CLI, merge the other snippet.

## Activate the fleet

Choose **Subagent Fleet** as the parent agent:

| Host | How to activate |
| --- | --- |
| VS Code | Select **Subagent Fleet** in the Chat agent picker. The `agent` tool is already in its profile. |
| GitHub Copilot app | Select **Subagent Fleet** in the prompt box's agent picker, or type `/agent` and choose it. |

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

## Copilot CLI

Copilot CLI has its own built-in subagents (research, rubber-duck, explore, task, security-review, code-review, and general-purpose), so the settings snippets, not the profiles in `.github/agents/`, are the supported CLI setup. Merge one of the settings snippets in [`copilot-cli/`](copilot-cli/README.md) into `~/.copilot/settings.json`:

- [`copilot-cli/subagents.json`](copilot-cli/subagents.json) (recommended) sets the session model and gives each built-in subagent the fleet's model and effort, plus a context tier.
- [`copilot-cli/subagents-budget.json`](copilot-cli/subagents-budget.json) is the lower-cost variant.

Check the result with `/model` and `/subagents`: `/subagents` should list the seven built-in subagents with the snippet's models, for example `general-purpose` on Claude Opus 5.5 (medium, or low with the budget snippet). `/fleet` enables the CLI's own parallel subagents. These settings stay in the CLI; they do not carry over to VS Code or the app.

## Model assignments

**Check the model and effort in your client.** The files set preferred models and `reasoning-effort` defaults. VS Code 1.136+ supports these defaults; other clients may handle them differently.

| Role | Profile file | Preferred model (`model`) | Reasoning effort (`reasoning-effort`) |
| --- | --- | --- | --- |
| Subagent Fleet | `subagent-fleet.agent.md` | Host session: Claude Sonnet 5.5 (not set in profile) | medium |
| Fleet Explore | `fleet-explore.agent.md` | Claude Sonnet 5.5 (copilot) | low |
| Fleet Task | `fleet-task.agent.md` | GPT-6 Luna (copilot) | low |
| Fleet General Purpose | `fleet-general-purpose.agent.md` | Claude Opus 5.5 (copilot) | medium |
| Fleet Research | `fleet-research.agent.md` | GPT-6 Sol (copilot) | high |

| Review role | Profile file | Preferred model (`model`) | Reasoning effort (`reasoning-effort`) |
| --- | --- | --- | --- |
| Fleet Rubber Duck | `fleet-rubber-duck.agent.md` | Claude Opus 5.5 (copilot) | medium |
| Fleet Code Review | `fleet-code-review.agent.md` | Claude Opus 5.5 (copilot) | medium |
| Fleet Security Review | `fleet-security-review.agent.md` | Claude Opus 5.5 (copilot) | high |

The [budget variant](#recommended-or-budget) (`budget/agents/`) changes the Fleet Explore and Fleet General Purpose rows. The same assignments, in both variants, are available for the Copilot CLI's built-in subagents as [settings snippets](copilot-cli/README.md).

### Why these models

The assignments follow the [Artificial Analysis](https://artificialanalysis.ai/models) benchmarks of 29 September 2026 and the [Copilot model prices](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) of the same date. Copilot's prices per 1M tokens (input / cached input / cache write / output) are: GPT-6 Sol $2 / $0.20 / $2.50 / $10 up to 272K input tokens, and $4 / $0.40 / $5 / $15 above; GPT-6 Luna $0.10 / $0.01 / $0.125 / $0.50 up to 272K; Claude Sonnet 5.5 $2 / $0.20 / $2.50 / $10 and Claude Opus 5.5 $4 / $0.20 / $5 / $20 at any context length. The Artificial Analysis "cost to run the index" figures are what the benchmark run cost, not a Copilot bill; use them as ratios between models.

For a coding fleet, Terminal-Bench 4.0 (agentic coding and terminal use) separates the models far more than the overall Intelligence Index does:

| Model and effort | Intelligence Index | Terminal-Bench 4.0 | Cost to run the index | Time per task |
| --- | --- | --- | --- | --- |
| GPT-6 Luna (low) | 21 | 0% | $11 | 0.2 min |
| GPT-6 Luna (medium) | 29 | 3% | $31 | – |
| GPT-6 Luna (high) | 32 | 5% | $48 | 2.3 min |
| GPT-6 Sol (high) | 43 | 26% | $610 | 2.3 min |
| GPT-6 Sol (xhigh) | 44 | 30% | $860 | 3.5 min |
| GPT-6 Sol (max) | 48 | 44% | $1,546 | 6.5 min |
| Claude Sonnet 5.5 (low) | 36 | 21% | $544 | 1.6 min |
| Claude Sonnet 5.5 (medium) | 41 | 30% | $701 | 2.1 min |
| Claude Sonnet 5.5 (high) | 47 | 44% | $1,176 | 3.6 min |
| Claude Sonnet 5.5 (xhigh) | 52 | 57% | $2,738 | 7.0 min |
| Claude Opus 5.5 (low) | 42 | 31% | $860 | 1.4 min |
| Claude Opus 5.5 (medium) | 51 | 53% | $1,627 | 3.6 min |
| Claude Opus 5.5 (high) | 54 | 57% | $2,172 | 4.8 min |
| Claude Opus 5.5 (xhigh) | 56 | 60% | $4,057 | 8.4 min |

What follows from this:

- **Fleet General Purpose** does the implementation work, the closest match to Terminal-Bench. GPT-6 Sol (high) scores 26% there. Claude Opus 5.5 (medium) scores 53% for 2.7x the cost, and failed implementation runs are the expensive part. Claude Sonnet 5.5 (medium) is the budget option: 30% for 1.15x the cost of Sol (high) at 2.1 min per task, at the price of 41 instead of 51 on the Intelligence Index.
  - Dividing index cost by Terminal-Bench score, Sonnet 5.5 (medium) has the lowest cost per solved task among models that score at least 20% on Terminal-Bench: $2,337, against $2,346 for Sol (high), $2,590 for Sonnet 5.5 (low), $2,673 for Sonnet 5.5 (high), $2,774 for Opus 5.5 (low), and $3,070 for Opus 5.5 (medium). GPT-6 Luna comes out lower on this ratio, but at 0-5% it is not a viable implementer.
  - Sol (high) is almost level on this ratio, but Sonnet 5.5 (medium) scores 30% to 26%, is faster (2.1 against 2.3 min per task), and has no long-context price step. Opus 5.5 (low) is the fastest option (1.4 min) but costs more per solved task. Sonnet 5.5 (high) scores 44% for 1.7x the cost of Sonnet 5.5 (medium).
- Above Sonnet 5.5 (high), use Opus instead. Sonnet 5.5 (xhigh) costs more than Opus 5.5 (high) for the same Terminal-Bench score, with lower intelligence and slower tasks, because Sonnet writes many more reasoning tokens at high efforts.
- **Fleet Explore** needs reliable tool use, not deep reasoning. GPT-6 Luna (high) spends 1.6x the output tokens of Luna (medium) (47M vs 29M) for +3 intelligence and 5% instead of 3% Terminal-Bench. Claude Sonnet 5.5 (low) is a real agentic model at 1.6 min per task. GPT-6 Luna (medium) is the budget option.
- **Fleet Task** runs one command and reports. GPT-6 Luna (low) is enough.
- **Fleet Research** is knowledge and long-context work, where the Intelligence Index is the better proxy. GPT-6 Sol (high) is the cheapest model in the 43-point band.
- **Reviews** stay on Claude Opus 5.5. Reviews are input-heavy and cache-friendly, and Opus reads cached input at the same $0.20 as Sonnet and Sol, so its premium is smaller in practice than in the table above; the remaining premium is on uncached input ($4 vs $2), cache writes ($5 vs $2.50), and output ($20 vs $10). Copilot charges Claude models one rate at any context length, while GPT-6 Sol switches to a long-context rate above 272K input tokens: input, cached input, and cache writes double, and output rises 1.5x. That makes long context free on Opus and costly on Sol.
- **The session model** (the coordinator) is the context that grows longest, and every subagent waits on it. Up to 272K tokens, Claude Sonnet 5.5 costs the same per token as GPT-6 Sol, including cache writes, and it has no long-context price step. Effort labels are not comparable across vendors: per task, Sonnet thinks longer at the same label. The coordinator therefore runs at medium effort. Sonnet 5.5 (medium) is faster than GPT-6 Sol (high) (2.1 min per task against 2.3), scores 30% to 26% on Terminal-Bench for 41 to 43 intelligence, and costs 15% more on the index, which the long-context step on Sol offsets once a session passes 272K tokens. Sonnet 5.5 (high) adds 6 intelligence points for 1.7x the cost and 1.7x the time; use it only when delegation quality falls short.
- GPT-6 Astra, GPT-5.6 Sol, and Gemini 3.8 Flash have no role. At medium and high effort, Opus 5.5 scores higher than GPT-6 Astra for less ($1,627 against $2,434, and $2,172 against $2,925); GPT-6 Sol beats GPT-5.6 Sol; Gemini 3.8 Flash streams fast but is so verbose that it ends up more expensive than Sonnet 5.5 (low) with a lower Terminal-Bench score.

### VS Code

The agent files use the [supported `model` field](https://code.visualstudio.com/docs/agent-customization/custom-agents#_custom-agent-file-structure). [All four models are listed for VS Code](https://docs.github.com/en/copilot/reference/ai-models/supported-models#supported-ai-models-per-client).

VS Code 1.136+ reads [`reasoning-effort` from custom-agent frontmatter](https://github.com/microsoft/vscode/pull/329263) as a per-agent default. The supported values are `low`, `medium`, `high`, `xhigh`, and `max`; the selected model must support the configured level. The coordinator does not set a model, so it uses the session's selected model with `medium` effort when supported. The profile does not set effort on individual subagent calls. In older VS Code versions, choose [Thinking Effort](https://code.visualstudio.com/docs/agent-customization/language-models#_configure-thinking-effort) in the model picker.

### Copilot app

Select the agent, then check the [session model and reasoning-effort pickers](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions#choosing-a-model). GitHub's model table has no separate desktop app column. The app docs do not confirm that it offers these models or applies a profile's `model` value.

### Context

No shared agent-profile field sets it. The window depends on the model and variant. [Extended context](https://docs.github.com/en/copilot/reference/ai-models/supported-models#models-with-extended-capabilities) is documented for supported models in VS Code and CLI, not the desktop app. The app does not document a context-tier picker or default.

For the main session, select Claude Sonnet 5.5 if your client offers it. The coordinator profile requests medium effort; check the active setting in clients that might not honor it. Default context is a target, not a shared profile setting.

## Check your setup

These steps cover the profiles in VS Code and the Copilot app. For Copilot CLI, see [Copilot CLI](#copilot-cli).

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

### Maintenance checks

For repository maintenance, parse all eight YAML profiles and the two budget profiles, check the preferred models and reasoning efforts against the tables, and confirm that the coordinator names existing specialists. When the benchmark or price data changes, update the [Recommended or budget](#recommended-or-budget) table as well as [Why these models](#why-these-models). Check that each budget profile differs from its recommended counterpart only in `model` and `reasoning-effort`; the check exits nonzero on any mismatch:

```bash
rc=0
for f in budget/agents/*.agent.md; do
  diff <(grep -vE '^(model|reasoning-effort):' ".github/agents/${f##*/}") <(grep -vE '^(model|reasoning-effort):' "$f") || rc=1
done
echo "exit $rc"; (exit $rc)
```

Run `git diff --check`.

There is no automated test runner for client behavior. Record those results separately.

**Next:** [Check the fleet on a test branch](#check-your-setup).
