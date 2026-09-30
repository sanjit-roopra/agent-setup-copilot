# Copilot CLI built-in subagent models

Two settings snippets set the CLI's default model, effort, and context tier,
and the model, effort, and context tier for its seven built-in subagents. They do not install the fleet
agents from this repository.

| Snippet | Use it when | Differs in | Trade-off (per role) |
| --- | --- | --- | --- |
| [`subagents.json`](https://raw.githubusercontent.com/sanjit-roopra/agent-setup-copilot/main/copilot-cli/subagents.json) — Sustained (recommended) | Repository-wide changes and analyses that require sustained judgment. | `general-purpose` on Claude Opus 5.5 (medium), `explore` on GPT-6.1 Sol (low). | `general-purpose`: 53% Terminal-Bench, index cost $1,627, 31 s per 500-token response. `explore`: $2 per 1M input tokens. |
| [`subagents-budget.json`](https://raw.githubusercontent.com/sanjit-roopra/agent-setup-copilot/main/copilot-cli/subagents-budget.json) — Bounded (budget) | Test generation, bounded fixes, and routine reports. | `general-purpose` on GPT-6.1 Sol (medium), `explore` on GPT-6 Luna (medium). | `general-purpose`: 48% Terminal-Bench, index cost $361, 14 s per 500-token response; the lowest estimated cost per solved task in the fleet. `explore`: $0.10 per 1M input tokens. |

The costs cover only the role named; the other roles cost the same in both
snippets. The index costs are what it cost Artificial Analysis to run its
benchmark suite, not a Copilot bill, so compare them as ratios. Explore mostly
reads files, so its cost follows the input price. See
[Why these models](../USAGE.md#why-these-models) for the full table.

Everything else is the same in both: session model GPT-6.1 Sol (medium, default context), Research
on GPT-6.1 Sol (high), Task on GPT-6 Luna (low), Rubber Duck and Code Review on
Claude Opus 5.5 (medium, long context), Security Review on Claude Opus 5.5
(high). See [Sustained or bounded](../USAGE.md#sustained-or-bounded) for when to pick
which, and [Model assignments](../USAGE.md#model-assignments) for the reasoning
and the benchmark numbers behind the choice.

Merge the snippet's **`model`, `effortLevel`, `contextTier`, and `subagents`
properties** into your `~/.copilot/settings.json` (or
`$COPILOT_HOME/settings.json`). Keep any other
properties already in that file. Do not replace the whole file unless you want
to discard your other CLI settings. Check the result with `/model` and
`/subagents` in Copilot CLI.

The models depend on what your Copilot plan and CLI version offer. To update
the list, edit the snippet and merge to `main`; the URL stays the same. This is
a file to copy manually, **not** an automatic nightly update. Automated updates
would need a separate way to merge the snippet without overwriting a user's
other settings.

`contextTier: "long_context"` is only used on Claude models. Copilot bills
Claude models at one rate regardless of context length, while GPT-6.1 Sol
and GPT-6 Luna switch to a higher "long context" rate above 272K input tokens
(for GPT-6.1 Sol, input, cached input, and cache writes double and output rises
1.5x). Putting a GPT-6
model on `long_context` would make that subagent noticeably more expensive.
