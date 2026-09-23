# Copilot CLI built-in subagent models

This is for Copilot CLI's **built-in** `explore`, `task`, `general-purpose`,
`rubber-duck`, `code-review`, `research`, and `security-review` agents. It does
not install the fleet profiles from this repository.

The [recommended `subagents` section](https://raw.githubusercontent.com/sanjit-roopra/agent-setup-copilot/main/copilot-cli/subagents.json)
is a fixed URL. It follows the [CLI settings format](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference#configuration-file-settings).
The models match the roles in [our model assignments](../USAGE.md#model-assignments).
They are curated, not chosen automatically by GitHub. Availability depends on
your Copilot plan and CLI version.

## Set up on Linux

Install Python 3, then download and review the small updater once:

```bash
mkdir -p "$HOME/.local/bin"
curl -fsSL https://raw.githubusercontent.com/sanjit-roopra/agent-setup-copilot/main/copilot-cli/update-subagents.py \
  -o "$HOME/.local/bin/update-copilot-subagents.py"
less "$HOME/.local/bin/update-copilot-subagents.py"
python3 "$HOME/.local/bin/update-copilot-subagents.py"
```

The updater fetches the latest recommendations each time it runs. It changes
only `model` and `effortLevel` for the seven built-in agents under
`subagents.agents`. It keeps other settings, custom agents, and existing
per-agent fields such as `contextTier`. It accepts JSON or JSON with comments.
Existing comments outside the seven built-in agent entries stay in place.
The first run creates `settings.json` if needed. To inspect the result, run
`/subagents` in Copilot CLI.

For a nightly update, find your Python path with `command -v python3`, then
add a line like this with `crontab -e` (replace `YOU` and the Python path):

```cron
0 3 * * * /usr/bin/python3 /home/YOU/.local/bin/update-copilot-subagents.py
```

Run it when Copilot CLI is idle, not while you are editing settings. The script
fails without changing settings if the download or validation fails. It uses
`COPILOT_HOME` if set, otherwise `~/.copilot`. It needs HTTPS access to the
public repository. To use an internal mirror, pass `--url` with its HTTPS URL.

## Keep recommendations current

Edit [`subagents.json`](subagents.json) when the team changes its recommended
models, then merge to `main`. The URL stays the same, and clients pick up the
new values at the next scheduled run. GitHub Actions checks the file and the
updater on pull requests and on pushes to `main`; Actions does not invent new
recommendations or need deployment credentials. The raw GitHub URL serves the
file directly from `main`, so GitHub Pages is not needed.
