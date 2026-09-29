# Budget fleet profiles

- **Recommended:** complex or unfamiliar work, where a failed change is expensive.
- **Budget:** routine, well-scoped tasks, where rerunning is cheap.

These two profiles replace their recommended counterparts in `.github/agents/` to run the
fleet at lower cost. They keep the same names, descriptions, tools, and
instructions; only the model and reasoning effort change.

| Profile | Recommended (`.github/agents/`) | Budget (`budget/agents/`) |
| --- | --- | --- |
| Fleet General Purpose | Claude Opus 5.5, medium | Claude Sonnet 5.5, medium |
| Fleet Explore | Claude Sonnet 5.5, low | GPT-6 Luna, medium |

The coordinator and the other five specialists are the same in both variants.
For Copilot CLI, use [`copilot-cli/subagents-budget.json`](../copilot-cli/subagents-budget.json)
instead of these profiles.
See [Recommended or budget](../USAGE.md#recommended-or-budget) for when to pick
which, and [Why these models](../USAGE.md#why-these-models) for the numbers.

## Install

Copy the recommended fleet first, then copy the budget profiles over the two recommended profiles:

```bash
cp -i .github/agents/*.agent.md /path/to/your-repository/.github/agents/
cp budget/agents/*.agent.md /path/to/your-repository/.github/agents/
```

To go back to the recommended fleet, copy the two recommended profiles again:

```bash
cp .github/agents/fleet-general-purpose.agent.md .github/agents/fleet-explore.agent.md /path/to/your-repository/.github/agents/
```

Keep these files identical to their `.github/agents/` counterparts apart from
the `model` and `reasoning-effort` lines. When you change a profile's
instructions, change both copies, then run the
[maintenance check](../USAGE.md#maintenance-checks).
