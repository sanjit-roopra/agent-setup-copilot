# Subagent Fleet for pi

**Start:** Install the package, log in to GitHub Copilot in pi, then run `/fleet <task>`.

This folder packages the fleet for the [pi coding agent](https://pi.dev). It
reads the same profiles as the Copilot clients, `.github/agents/*.agent.md` and
`budget/agents/*.agent.md`, so there is one set of instructions to maintain.
pi gets the same specialists, models, and reasoning effort as the Copilot
profiles, plus web search through your GitHub Copilot login.

## Requirements

- pi 0.87.1 or later (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`).
- A GitHub Copilot plan that includes the fleet's models.
- pi logged in to GitHub Copilot: run `/login` in pi and choose **GitHub Copilot**.

## Install

For yourself, in every repository:

```bash
pi install git:github.com/sanjit-roopra/agent-setup-copilot
```

For a team, in one repository: run this in the repository and commit the
`.pi/settings.json` it writes. Teammates get the fleet after they trust the
repository in pi.

```bash
pi install -l git:github.com/sanjit-roopra/agent-setup-copilot
```

Update with `pi update --extensions`. Remove with `pi remove git:github.com/sanjit-roopra/agent-setup-copilot`.
To pin a version, append a tag or commit, for example `...agent-setup-copilot@<tag>`.

## Use the fleet

| You want | Do this |
| --- | --- |
| The coordinator to plan, delegate, and combine results | `/fleet <task>` |
| One specialist directly | Ask for it by name, for example "Use fleet-explore to find where sessions are created." |

`/fleet` sends the **Subagent Fleet** instructions with your task and limits
the session to the coordinator's tools (`fleet`, `read`, `grep`, `find`, `ls`)
until the run finishes. Your normal tools come back afterwards.

Each specialist runs as a separate pi process with its own context window,
model, and tools. The `fleet` tool runs one specialist, several in parallel
(up to 8 tasks, 4 at a time), or a chain in which each step receives the
previous step's output.

| Specialist | Sustained (recommended) model | Bounded (budget) model | Tools |
| --- | --- | --- | --- |
| `fleet-general-purpose` | Claude Opus 5.5, medium | GPT-6.1 Sol, medium | read, grep, find, ls, edit, write, bash |
| `fleet-explore` | GPT-6.1 Sol, low | GPT-6 Luna, medium | read, grep, find, ls, bash |
| `fleet-task` | GPT-6 Luna, low | same | bash, read |
| `fleet-rubber-duck` | Claude Opus 5.5, medium | same | read, grep, find, ls, bash |
| `fleet-code-review` | Claude Opus 5.5, medium | same | read, grep, find, ls, bash |
| `fleet-security-review` | Claude Opus 5.5, high | same | read, grep, find, ls, bash |
| `fleet-research` | GPT-6.1 Sol, high | same | read, grep, find, ls, fleet_web_search, fleet_web_fetch |

The models come from the profiles' `model` and `reasoning-effort` lines. For
example, `Claude Opus 5.5 (copilot)` with `medium` becomes
`github-copilot/claude-opus-5.5:medium`. The coordinator session uses the
model and thinking level you picked in pi; the coordinator profile's
`reasoning-effort` is not applied.

If a profile lists a Copilot tool that pi has no equivalent for, that tool is
left out and `/fleet` shows a warning. A specialist whose tools all lack an
equivalent runs with no tools, never with pi's defaults.

### Use the Bounded (budget) fleet

Set `PI_FLEET_VARIANT=budget` before you start pi. See
[Sustained or bounded](../USAGE.md#sustained-or-bounded) for when to use it.

```bash
export PI_FLEET_VARIANT=budget      # macOS and Linux
setx PI_FLEET_VARIANT budget        # Windows; open a new terminal afterwards
```

### Override a specialist

Put a pi agent file with the same name in `~/.pi/agent/agents/`, for example
`~/.pi/agent/agents/fleet-explore.md`, and it replaces the packaged one:

```markdown
---
name: fleet-explore
description: Quickly investigate focused codebase questions.
tools: read, grep, find, ls
model: github-copilot/claude-haiku-4.5:low
---

Your instructions here.
```

## Web tools

The package adds two tools. Every session can use them, and only
`fleet-research` among the specialists has them.

| Tool | How it works | Login | Limits |
| --- | --- | --- | --- |
| `fleet_web_search` | Sends one question to GitHub's hosted MCP server (`api.githubcopilot.com/mcp/`), the same web search Copilot CLI uses. It returns an answer with source URLs. | Your pi GitHub Copilot login, then `gh auth token --hostname github.com`, then `GH_TOKEN` or `GITHUB_TOKEN` | Set by your Copilot plan |
| `fleet_web_fetch` | Downloads the page on your machine and converts HTML to Markdown. | None | Up to 5 MB per page and 30 seconds; public addresses only; sites behind a Cloudflare challenge, such as npmjs.com, refuse it |

The search toolset is not in GitHub's public MCP documentation. The package
requests it the way Copilot CLI does, with the `X-MCP-Toolsets: web_search`
header. If GitHub changes this, `fleet_web_search` fails with the HTTP error
and the rest of the fleet keeps working.

`fleet_web_fetch` refuses loopback, private, link-local, and cloud metadata
addresses, such as `localhost`, `192.168.1.1`, and `169.254.169.254`. It checks
the first URL and every redirect, and it connects to the exact IP address it
checked, so a hostname cannot switch to a private address between the check
and the connection. It returns the page marked as untrusted content, because
text on a page can try to give the model instructions. It connects directly and
ignores proxy settings, so it does not work on networks that require an HTTP
proxy.

The tool names start with `fleet_` so they do not clash with other packages,
such as pi-web-access.

## MCP servers

The package does not turn on MCP. With pi 0.87.1, MCP support comes from a
separate package that adds about 1,000 tokens to every session, even with no
servers configured. If you use MCP servers, install it yourself:

```bash
pi install npm:pi-mcp-adapter
```

It reads `.mcp.json` in a project and `~/.config/mcp/mcp.json` for all
projects. Run `/mcp-adapter setup` to import servers from VS Code, Claude Code,
Cursor, and other clients. Copilot CLI's `~/.copilot/mcp-config.json` is not
imported; copy its servers by hand.

pi has built-in MCP support on its main branch that costs nothing when no
servers are configured. Once it ships in a release, it replaces the adapter.

## Token cost

With nothing else loaded, the package adds about 1,060 input tokens to every
session: about 755 for the `fleet` tool and about 305 for the two web tools
(measured on Claude Sonnet 5.5). `/fleet` sends about 1,700 more tokens of
coordinator instructions with the task. Each specialist starts its own session
with only its own tools.

## Differences from the Copilot clients

- There is no agent picker. `/fleet` takes the place of selecting **Subagent Fleet**. It is not Copilot CLI's `/fleet` command, which runs the CLI's built-in subagents.
- `fleet-research` has web tools but no GitHub MCP tools such as `github/get_me`.
- Tool lists limit what each specialist can call. As in the Copilot clients, they are not a security sandbox; `bash` can still change files.
- `fleet-research` can read local files and fetch any public URL. A web page that tricks it could make it send file contents to another site in a URL. Do not point it at untrusted pages in a repository that holds secrets.
- A specialist cannot delegate again, because the `fleet` tool is not in its tool list.
- The coordinator profile's `agents:` list decides which specialists `/fleet` offers the model, but pi does not enforce it: the `fleet` tool can run any agent it finds, including your own agents in `~/.pi/agent/agents/`.

## Maintain

- Edit the profiles in `.github/agents/` and `budget/agents/`; pi picks up changes on the next delegation.
- A new Copilot model name only works if pi knows the same model ID. Check with `/model` in pi. If pi reports `Model ... not found`, run `pi update --models`.
- Run `npm test` after you change a profile or the extension code. The tests load the real profiles and check models, tools, and the budget overlay.
- `extensions/fleet/index.ts` and `agents.ts` are adapted from pi's `examples/extensions/subagent` (MIT, Copyright (c) 2025 Mario Zechner). Keep the notice in their headers.
