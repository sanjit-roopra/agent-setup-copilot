# Bounded (budget) fleet profiles

- **Sustained (recommended):** repository-wide changes and analyses that require sustained judgment.
- **Bounded (budget):** test generation, bounded fixes, and routine reports.

These two profiles replace their Sustained counterparts in `.github/agents/` to run the
fleet as the Bounded variant, at lower cost. They keep the same names, descriptions, tools, and
instructions; only the model and reasoning effort change.

| Profile | Sustained (recommended) — `.github/agents/` | Bounded (budget) — `budget/agents/` |
| --- | --- | --- |
| Fleet General Purpose | Claude Opus 5.5, medium | GPT-6.1 Sol, medium |
| Fleet Explore | GPT-6.1 Sol, low | GPT-6 Luna, medium |

The coordinator and the other five specialists are the same in both variants.
For Copilot CLI, use [`copilot-cli/subagents-budget.json`](../copilot-cli/subagents-budget.json)
instead of these profiles.
See [Sustained or bounded](../USAGE.md#sustained-or-bounded) for when to pick
which, and [Why these models](../USAGE.md#why-these-models) for the numbers.

## Install

Copy the Sustained fleet first, then copy the Bounded profiles over the two Sustained profiles:

```bash
cp -i .github/agents/*.agent.md /path/to/your-repository/.github/agents/
cp budget/agents/*.agent.md /path/to/your-repository/.github/agents/
```

To go back to the Sustained fleet, copy the two Sustained profiles again:

```bash
cp .github/agents/fleet-general-purpose.agent.md .github/agents/fleet-explore.agent.md /path/to/your-repository/.github/agents/
```

Keep these files identical to their `.github/agents/` counterparts apart from
the `model` and `reasoning-effort` lines. When you change a profile's
instructions, change both copies, then run the
[maintenance check](../USAGE.md#maintenance-checks).
