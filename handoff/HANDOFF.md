# Handoff: can GitHub Copilot be made cheaper with Shunt-style routing or a subagent fleet?

Written 2026-09-20 for an independent reviewer. Please verify, do not trust. Every claim is tagged:

- **[MEASURED]** I ran it; raw data is in `handoff/raw/`.
- **[READ]** Taken from a web page, mostly through a summarising fetch tool, so re-read the page.
- **[INFERRED]** My reasoning. Most likely to be wrong.

## The question

The owner wants lower GitHub Copilot cost. Two approaches exist in this repo (`sanjit-roopra/agent-setup-copilot`, branch `codex/strict-fleet-routing`, PR #1):

1. `shunt-copilot/` — a Copilot plugin copying Spotify's Shunt for Claude Code ([source](https://github.com/sorantis/portal-ai-plugins/tree/add-shunt-claude/plugins/shunt), [article](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90)). A PreToolUse hook blocks large file reads; a skill sends them to a cheap model in a separate `copilot` CLI session; only a summary returns.
2. `.github/agents/` — a "Subagent Fleet": a `gpt-5.6-sol` coordinator that dispatches cheap in-session subagents (`gpt-5.6-luna`, `gemini-3.8-flash`, others per `.github/fleet/policy.json`).

The owner reports seeing lower token usage in long real sessions with the fleet. My benchmark did not confirm a lower total bill. That disagreement is unresolved.

## Billing facts

- **[READ]** Copilot bills tokens as AI credits, 1 credit = $0.01, per-model prices per million tokens: <https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing>. Premium requests survive only on legacy annual Pro/Pro+ plans. The owner says they are not on one.
- **[READ]** Prices used: `gpt-5.6-luna` $0.20 input / $0.02 cached / $0.25 cache write / $1.20 output. `gpt-5.6-sol` $4 / $0.40 / $5 / $20. `gemini-3.8-flash` $0.75 / $0.075 / $3.75.
- **[MEASURED]** Copilot CLI 1.0.86 `--usage-output-file` reports `totalNanoAiu`. Divided by 1e9 it equalled my own calculation from those prices to three decimals in all 10 baseline runs (5 Luna, 5 Sol). So credits = tokens x published price.
- **[MEASURED]** Every model call carries roughly 12,000 to 14,000 tokens of fixed context before any file is read.
- **[MEASURED]** Copilot CLI's native `view` tool refuses a whole-file read somewhere between 16 KB (allowed) and 20 KB (refused: "File too large to read at once").

## The benchmark

`shunt-copilot/scripts/benchmark.mjs`, documented in `shunt-copilot/BENCHMARK.md`. It sends identical prompts through `copilot -p` in three arms and reads the CLI's own usage files:

- `baseline`: plain CLI, `--model X`
- `shunt`: same, plus `--plugin-dir shunt-copilot`
- `fleet`: `--agent subagent-fleet` after `scripts/install.mjs --host cli` into the test project. The coordinator is pinned to `gpt-5.6-sol`.

The benchmark never writes a subagent brief. The fleet's own coordinator does.

Reproduce (costs real credits, roughly $1.50 each):

```sh
cd shunt-copilot
node scripts/benchmark.mjs --dry-run
node scripts/benchmark.mjs --model gpt-5.6-sol --arm baseline,shunt,fleet
node scripts/benchmark.mjs --model gpt-5.6-sol --arm baseline,shunt,fleet --scenario long-session
node --test tests/*.test.mjs        # 29 unit tests, no network
```

## Results, all [MEASURED], one run per arm

Five single-question sessions, main model `gpt-5.6-sol`, AI credits (`raw/sol-3-arms.json`):

| Scenario | baseline | shunt | fleet |
| --- | ---: | ---: | ---: |
| find-a-value | 5.96 | 4.12 | 6.33 |
| mid-size-file | 4.63 | 12.86 | 3.60 (failed answer check) |
| summarise-big-file | 17.68 | 8.10 | 7.49 |
| cross-file-question | 5.86 | 5.92 | 6.34 |
| generate-tests | 11.61 | 20.07 | 24.13 |
| Total | 45.73 | 51.06 | 47.89 |

One 8-question conversation, `gpt-5.6-sol` (`raw/sol-long-session-3-arms.json`, per-agent split in `raw/sol-long-session-fleet-usage.json`):

| | baseline | shunt | fleet |
| --- | ---: | ---: | ---: |
| Total AI credits | 44.84 | 54.30 | 49.72 |
| Sol credits | 44.84 | not split | 34.04 |
| Cheap-helper credits | 0 | not split | 15.68 (10 Luna subagents) |
| Sol input tokens | 422,363 | 573,701 | 229,506 |
| Helper input tokens | 0 | 58,452 | 1,729,184 |
| Context at last call | 33,058 | 30,961 | 18,158 |
| Seconds | 105 | 258 | 682 |

Same 8-question conversation, plain CLI, main model `gpt-5.6-luna`: **6.37 credits**, 20 calls, 614,476 input tokens, all answer checks passed. Use `raw/luna-long-session-baseline-usage.json`. Do **not** use the totals in `raw/luna-long-session-baseline.json`: that file was written before I fixed a bug and over-counts (27.7).

Five single questions, main `gpt-5.6-luna`, baseline against Shunt (`raw/luna-5-scenarios.json`): Shunt cost +59%, +87%, +161%, +96% in the four scenarios where it delegated.

## What I conclude, and how sure I am

1. **[MEASURED]** Shunt did not save money in Copilot in any configuration tested. Delegation added main-model calls (for example 2 to 7, 4 to 9), each carrying the fixed context, plus a cold second CLI session.
2. **[MEASURED]** The fleet cut the expensive model's share: Sol input tokens -46%, Sol cost -24% in the long session. This matches what the owner sees.
3. **[MEASURED]** The fleet's total was still +11% in that session. The coordinator's briefs were small and specific (about 500 characters, "Read only src/pricing-rules.mjs ..."). The helper cost came from subagents paging a 69 KB file in ranges: four of ten made 18 to 22 calls and resent about 350,000 mostly cached tokens each.
4. **[MEASURED]** The one large, certain saving: a cheaper main model. The same long session cost 6.37 credits on Luna against 44.84 on Sol, -86%, with the same automated checks passing. Those checks are regex matches on facts, not a judgement of reasoning quality.
5. **[INFERRED]** Why Spotify's 90% does not transfer: their harness (`evals/run.sh` upstream) estimates characters / 4 of raw files against the summary, ignores worker cost and extra calls, their worker (AiKA) is not on the Claude bill, and Claude Code reads whole files where Copilot CLI refuses above about 16 to 20 KB.
6. **[INFERRED]** The fleet may win on the total bill in longer sessions on a large repository, because the baseline's carried context keeps growing while the coordinator's stays near 18,000 tokens. Not measured. At 8 questions the baseline context was only 33,000.

## Known weaknesses of my work

- One run per arm. `find-a-value` under Shunt never delegated, did the same work as the baseline, and still came out 31% cheaper. Differences under about a third are noise.
- The test project is synthetic and tiny: four files, 6 to 69 KB, generated by `buildFixture()`. Questions only, apart from one test-generation task. No long implementation work.
- The `mid-size-file` prompt is ambiguous ("which tiers exist"); the fleet's failed check there is the prompt's fault.
- Shunt's `shunt-code-writer` skill text makes the model hunt for the script path; in one Luna run it wasted about six calls. That inflates Shunt's `generate-tests` figure.
- I fixed one bug mid-way: a resumed session's usage file is cumulative, and I first summed turns. Results above use the corrected logic, except the Luna file flagged above.
- I first told the owner the subagents "explore the project again". The transcripts show that was wrong; see point 3.
- Web findings came through a summarising fetch tool. Re-read before relying on: [optimize-ai-usage](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage) ("run subagents on cheaper models", auto model discount, do not switch model mid-session), [VS Code subagents](https://code.visualstudio.com/docs/copilot/agents/subagents), [CLI /fleet](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/fleet), [arXiv 2607.12161](https://arxiv.org/abs/2607.12161) ("Token Reduction Is Not Cost Reduction").
- VS Code and the Copilot app were never measured. Only Copilot CLI.

## What would settle it

1. Run on the owner's real repository with their real prompt sequence. Built, dry-run and clone step checked, never run live:
   `node scripts/benchmark.mjs --model gpt-5.6-sol --arm baseline,fleet --project /path/to/repo --prompts questions.txt`
2. Use `--runs 3` or more and compare medians.
3. Make the session long enough for the baseline context to pass 100,000 tokens, and include implementation tasks, not only questions.
4. Untested ideas: a cheaper coordinator than Sol; `Fleet Explore` searching before paging a file; trimming the 12,000-token fixed context (the CLI loaded 4 MCP servers in these runs).

## Where things are

- Code and docs: PR #1, commits `1f94fbe`, `c318338`, `45cab65`, `1b5a23b`, `876343b`.
- Raw results: `handoff/raw/*.json` (untracked, not committed).
- Full transcripts were in a session scratch folder and may be gone; re-run to regenerate.
