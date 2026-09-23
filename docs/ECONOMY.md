# Lower-cost Copilot workflow

Use **Economy** for routine codebase questions and scoped implementation.
It runs directly on `gpt-5.6-luna`, with read, search, edit and execute tools.
There is no coordinator round trip or automatic review session. Repository and
user requirements for independent review still apply.

```sh
node scripts/install.mjs --host cli --dest /path/to/repository
cd /path/to/repository
copilot --agent economy --max-ai-credits 10
```

The credit limit is an optional session soft limit, not a guarantee of final cost
or task completion. Existing installations with modified fleet files require
reviewing the installer conflicts before using `--force`.
For VS Code, install with `--host vscode` and select **Economy** in the agent picker.
Live measurements here cover the CLI only.

## Why this changes the bill

The original strict fleet was designed for role separation, not minimum total cost.
Its Sol coordinator could only delegate, and every implementation triggered an
independent Sol review, including a packet-generation step. The fleet now permits
small tasks directly and makes review conditional on requirements and material risk.
The historical results below describe the original delegation-only version.

The handoff's raw eight-question session reports 44.841 credits for plain Sol,
49.720 for the fleet, and 6.374 for plain Luna. The Luna value comes from
`handoff/raw/luna-long-session-baseline-usage.json`; the earlier results summary
overcounts cumulative usage. The fleet spent 34.04 credits on Sol and 15.68 on
helpers. To beat that Sol baseline while retaining the same coordinator cost,
helpers would need to cost below about 10.80 credits: a reduction of over 31%.
That is a possible optimization target, not evidence that it has been achieved.

Economy makes direct cheap execution available as an installed profile, including
implementation, targeted retrieval, verification and a stopping rule for failed
attempts. It remains a separate option from the Sol-led fleet and retains the specialist model pins.

## Use stronger reasoning where it earns its cost

For a difficult architecture decision, start a separate strong-model planning
session. Ask for a short plan with paths, constraints and acceptance criteria.
Give that plan to Economy to implement and test. When independent review is
required, select Fleet Code Review directly with the exact diff scope. Count
planning, execution, review and rework together when comparing cost.

If Economy cannot resolve contradictory evidence or two different fixes fail
the same check, it returns a focused handoff instead of repeatedly retrying.
Continue that handoff in a fresh strong-model session. This escalation is explicit;
Economy has no delegation tool and does not automatically upgrade its model.
For complex coordinated work, the original Subagent Fleet remains available.

Preserve the model and tool configuration within a session to retain cache reuse.
Disable unused MCP servers before starting, using `--disable-mcp-server <name>`;
`--disable-builtin-mcps` does not disable user-configured servers. Do not remove
tools needed for the task. Tool pruning has not been isolated in these measurements.

GitHub's [usage optimization guidance](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage)
supports lighter models for scoped execution, stable session configuration and
smaller tool sets. Its [pricing reference](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
defines one AI credit as $0.01. Check current rates before projecting monthly savings.

## Reproduce the comparison

Measured on 2026-09-20 using Copilot CLI 1.0.86. Three fresh runs per arm of the
same `generate-tests` prompt produced these total AI credits:

| Arm | Run 1 | Run 2 | Run 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| Plain Sol | 12.271 | 7.979 | 11.372 | 11.372 |
| Economy (Luna) | 0.564 | 0.773 | 0.706 | 0.706 |

Economy cost **93.8% less at the median**, despite using 28% more input tokens.
The CLI usage files confirm the requested model in all six sessions and no
subagents. All six generated suites passed against the original implementation.
Raw totals are in `handoff/raw/economy-implementation-3-runs.json`.

An additional independent quality check introduced seven defects one at a time:
accepting duplicate users, creating inactive users, failing to store users,
accepting missing lookups, ignoring deactivation, always reporting inactive,
and treating unknown users as active. All three Sol suites caught all seven.
Two Economy suites caught all seven; one caught six, missing the always-inactive
defect. Results are in `handoff/raw/economy-implementation-mutations.json`.
This is evidence of a real quality gap in one sample, not equivalent quality.
The benchmark's built-in pass/fail check does not include this mutation audit.

One fresh eight-question Economy session cost **2.410 credits**, made 24 model
calls with no helpers, and passed the existing factual checks. Its raw results
are in `handoff/raw/economy-long-session.json`. The earlier plain Sol session cost
44.841 credits, but that is a historical single-run comparison, not a repeated
paired experiment. The checks do not grade every reasoning claim.

The actionable saving is cheap execution with appropriate verification, and
strong planning or review when needed. The cost of those stronger steps and any
rework must be added; they were not included in the direct-execution measurements.

From the repository root:

```sh
node shunt-copilot/scripts/benchmark.mjs --model gpt-5.6-sol \
  --arm baseline,economy --scenario generate-tests --runs 3
node shunt-copilot/scripts/benchmark.mjs --model gpt-5.6-sol \
  --arm baseline,economy --scenario long-session --runs 3
```

These are paid live runs in throwaway fixture repositories. `economy` pins Luna;
`--model` controls the baseline. The benchmark uses CLI-reported credits including
subagents. For real work, use `--project /path/to/repo --prompts questions.txt` and
manually assess the answers and changes: its real-project mode has no quality oracle.
Synthetic success cannot establish equal reasoning quality on complex production work.
