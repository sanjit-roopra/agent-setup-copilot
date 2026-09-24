# Copilot CLI built-in subagent models

The [settings snippet](https://raw.githubusercontent.com/sanjit-roopra/agent-setup-copilot/main/copilot-cli/subagents.json)
sets the CLI's default model and the model, effort, and context tier for its
seven built-in subagents. It does not install the fleet agents from this repository.

Merge its **`model` and `subagents` properties** into your
`~/.copilot/settings.json` (or `$COPILOT_HOME/settings.json`). Keep any other
properties already in that file. Do not replace the whole file unless you want
to discard your other CLI settings. Check the result with `/model` and
`/subagents` in Copilot CLI.

The models follow [our role assignments](../USAGE.md#model-assignments) and
depend on what your Copilot plan and CLI version offer. To update the list,
edit [`subagents.json`](subagents.json) and merge to `main`; the URL stays the
same. This is a file to copy manually, **not** an automatic nightly update.
Automated updates would need a separate way to merge the snippet without
overwriting a user's other settings.
