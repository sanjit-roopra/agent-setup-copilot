# Copilot CLI built-in subagent models

The [settings snippet](https://raw.githubusercontent.com/sanjit-roopra/agent-setup-copilot/main/copilot-cli/subagents.json)
contains model choices for Copilot CLI's seven built-in subagents. It does not
install the fleet agents from this repository.

Copy its **`subagents` property** into your `~/.copilot/settings.json` (or
`$COPILOT_HOME/settings.json`). Keep any other properties already in that file.
Do not replace the whole file unless you want to discard your other CLI
settings. You can check the result with `/subagents` in Copilot CLI.

The models follow [our role assignments](../USAGE.md#model-assignments) and
depend on what your Copilot plan and CLI version offer. To update the list,
edit [`subagents.json`](subagents.json) and merge to `main`; the URL stays the
same. This is a file to copy manually, **not** an automatic nightly update.
Automated updates would need a separate way to merge the snippet without
overwriting a user's other settings.
