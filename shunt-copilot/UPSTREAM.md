# What Shunt actually implements

This is an independent Node implementation informed by the [Shunt source at commit d39ced22231aa6e2147d6265fb92ba6123a2bbb0](https://github.com/sorantis/portal-ai-plugins/tree/d39ced22231aa6e2147d6265fb92ba6123a2bbb0/plugins/shunt), on `add-shunt-claude`, inspected on 2026-09-18. The motivating [Spotify article](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90) describes the cost benefits of keeping routine work away from the main reasoning model. Its savings are not measurements of this implementation.

## Upstream execution path

1. `hooks/hooks.json` registers Claude `PreToolUse` hooks for Read and Bash. Neither hook calls a cheap model.
2. `check-file-size` counts lines and blocks a whole-file read above 350 lines. Merely supplying offset or limit exempts the request. The denial tells the agent to use the bulk-reader skill.
3. `check-bash-read` examines simple commands beginning with cat/head/tail/less/more. It skips commands containing pipes or output redirection and checks the first non-flag token as a file. It is not a complete shell parser.
4. `skills/bulk-reader/SKILL.md` tells the main agent to call `scripts/bulk-read` with a question and paths. The helper loads files directly into a temporary source bundle, then invokes the Portal AiKA `bulk-reader` mode. The main agent receives the answer rather than those raw files.
5. `skills/code-writer/SKILL.md` instructs the main agent to delegate predictable generation to `scripts/code-write`. That script requires a spec and reference file. With a target it writes worker output to disk and prints counts; without a target it prints code. There is **no Write hook** enforcing this choice.
6. `scripts/lib/aika.sh` resolves named/pinned modes, checks transport prerequisites, bounds the request passed through argv, invokes the Portal action, validates the returned mode and text, and handles errors. Each call is independent; follow-ups resubmit source.

The main conversation keeps design, reasoning and verification. A cheap model is not being installed as a replacement implementation of every Read/Write tool. It is an explicit helper the agent calls after a denial or a skill instruction.

## Correspondence and deliberate differences

| Shunt component | Here |
| --- | --- |
| Claude plugin / Read and Bash hooks | Copilot plugin with a global PreToolUse hook and adapters for CLI/app and VS Code envelopes |
| Read denial points to bulk-reader | Denial includes a stable marker, skill name and absolute helper path |
| Portal AiKA modes | Fresh authenticated Copilot CLI invocation, explicit model and required worker profile |
| XML corpus through Portal argv | JSON corpus through CLI stdin; avoids shell/argv quoting and argument-size limits |
| Any offset/limit exempts read | Validate positive bounded ranges and byte size; no offset-only exemption |
| Line threshold only | 350-line and 24 KiB read budgets; bounded file scanning |
| First shell filename checked | All filenames in supported simple commands checked; complex shell syntax still outside scope |
| Code may print to stdout | Target mandatory; only metadata returns to the main conversation |
| Target can be overwritten | New targets only; atomic no-clobber publication; candidates for revisions |
| Removes every line beginning with a code fence | Removes only one enclosing fence, preserving embedded Markdown examples |
| Portal returns text envelope | Parse CLI JSONL, validate model/final result, discard raw events and errors that may echo source |
| Ephemeral Portal invocation | Independent CLI sessions, but normal CLI history retention can still apply |

There is no new third-party runtime dependency, Portal installation, API-key configuration, or coupling to the fleet agents. Node and Copilot CLI are runtime prerequisites.

## Why one plugin can target three hosts

The common integration is a **plugin containing skills and command hooks**, not VS Code-specific agent-frontmatter hooks. The package uses the supported legacy Copilot manifest so it can explicitly point at `hooks/hooks.json` and `skills/`. Do not add the Agent Plugins 1.0 `$schema` without also moving the hooks into that format's `com.github.copilot/` namespace.

- [GitHub plugin formats and components](https://docs.github.com/en/copilot/concepts/agents/about-plugins) document CLI and app plugin support.
- [VS Code plugin formats and local registration](https://code.visualstudio.com/docs/agent-customization/agent-plugins) document Copilot-format plugins, hook support and PLUGIN_ROOT substitution.
- [GitHub hook reference](https://docs.github.com/en/copilot/reference/hooks-reference) documents native/PascalCase inputs and permission decisions. The hook emits native decision fields plus VS Code's `hookSpecificOutput` envelope; small reads return `{}` so normal user permissions are preserved.
- [VS Code hook reference](https://code.visualstudio.com/docs/agent-customization/hooks) documents its nested output contract.
- [Copilot app customization](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app) documents marketplace installation and plugin hooks/skills.
- [CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) documents model selection, tool restrictions, piped programmatic input, JSONL output, and required model policies.

Runtime model/final-event validation was additionally checked against actual CLI 1.0.86 output. App/VS Code interactive validation is intentionally tracked separately in the README; documentation support cannot substitute for exercising their installed versions.
