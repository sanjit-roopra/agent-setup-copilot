# Copilot CLI built-in subagent models

Two settings snippets set the CLI's default model and the model, effort, and
context tier for its seven built-in subagents. They do not install the fleet
agents from this repository.

| Snippet | Use it when | Differs in |
| --- | --- | --- |
| [`subagents.json`](https://raw.githubusercontent.com/sanjit-roopra/agent-setup-copilot/main/copilot-cli/subagents.json) (recommended) | You want the higher Terminal-Bench score of the two snippets for implementation work (53% vs 40%). | `general-purpose` on Claude Opus 5.5 (medium), `explore` on Claude Sonnet 5.5 (low). |
| [`subagents-budget.json`](https://raw.githubusercontent.com/sanjit-roopra/agent-setup-copilot/main/copilot-cli/subagents-budget.json) | You want the lowest estimated cost per solved task (index cost divided by Terminal-Bench score) for `general-purpose` among models that can do implementation work (at least 20% on Terminal-Bench). It costs about 1.4x GPT-6 Sol (high) on the index, against 2.7x for Opus 5.5 (medium), and runs 2.6x faster than Opus 5.5 (medium); see [Why these models](../USAGE.md#why-these-models). | `general-purpose` on Claude Opus 5.5 (low), `explore` on GPT-6 Luna (medium). |

Everything else is the same in both: session model Claude Sonnet 5.5, Research
on GPT-6 Sol (high), Task on GPT-6 Luna (low), Rubber Duck and Code Review on
Claude Opus 5.5 (medium, long context), Security Review on Claude Opus 5.5
(high). See [Model assignments](../USAGE.md#model-assignments) for the reasoning
and the benchmark numbers behind the choice.

Merge the snippet's **`model` and `subagents` properties** into your
`~/.copilot/settings.json` (or `$COPILOT_HOME/settings.json`). Keep any other
properties already in that file. Do not replace the whole file unless you want
to discard your other CLI settings. Check the result with `/model` and
`/subagents` in Copilot CLI.

The models depend on what your Copilot plan and CLI version offer. To update
the list, edit the snippet and merge to `main`; the URL stays the same. This is
a file to copy manually, **not** an automatic nightly update. Automated updates
would need a separate way to merge the snippet without overwriting a user's
other settings.

`contextTier: "long_context"` is only used on Claude models. Copilot bills
Claude models at one rate regardless of context length, while GPT-6 and GPT-5.6
models switch to a higher "long context" rate above 272K tokens (for GPT-6 Sol,
input and cached input double and output rises 1.5x). Putting a GPT-6
model on `long_context` would make that subagent noticeably more expensive.
