# Handoff 2: greenfield tasks, the ladder, HydraFusion, and what the community measured

Written 2026-09-22 for the next agent. It continues `handoff/HANDOFF.md` (2026-09-20), which covers the Shunt plugin, the subagent fleet and the cost experiments up to the ladder. Read that first for the billing facts and the benchmark. This file covers only what happened after it. Every claim is tagged:

- **[MEASURED]** Run on this machine with Copilot CLI 1.0.86; raw data under `handoff/raw/greenfield/`.
- **[READ]** From a web page or forum thread, fetched by a research subagent through a summarising tool, so re-read before relying on it. Community thread text is under `handoff/raw/community/` (Hacker News exact; Reddit via RSS, no scores).
- **[INFERRED]** My reasoning. Most likely to be wrong.

All costs are AI credits, 1 credit = $0.01, read from the CLI's own usage file or from the session event log (`totalNanoAiu / 1e9`). Nothing in this file is committed yet; `git status` shows the full list.

## The question that drove this round

The owner wants to know which model to use for which prompt so the bill drops without the result getting worse. The earlier round measured this on audit-style tasks with an answer key. This round tried it on a task with no answer key: build a Pong game in Python from an empty repository, then act on the owner's play-test feedback.

## What was built (uncommitted)

| Path | What it is | Tests |
| --- | --- | --- |
| `experiments/ladder.mjs` | Added `--compare-strong` (Sol alone as a yardstick in a third clone), `--spec-model` (a strong model writes `SPEC.md` + acceptance tests first; attempts cannot edit them, they are restored before every gate run), `--cheap-attempts 1`, empty-repo support (`--repo` may be missing, an empty dir, or a repo with no commits), arbitration in a copy `ladder-final` so `attempt-a`/`attempt-b` stay untouched, and `__pycache__`/`*.pyc`/tool caches excluded in every clone | `node --test experiments/tests/ladder.test.mjs`, 12/12 pass, spends nothing |
| `experiments/prompts/spec-writer.md` | Instructions for the spec-writing model | |
| `experiments/tasks/pong.md`, `experiments/tasks/pong-one-liner.md` | The mid-detail and the one-line Pong task | |
| `experiments/gates/tty-smoke.py` | Starts a terminal program in a real pseudo-terminal, fails on early exit or a traceback. Costs nothing. Caught a crash that 490 lines of unit tests missed | Checked by hand on 7 builds; no automated test |
| `experiments/fusion-run.py` | Drives the interactive Copilot CLI in a pty to use HydraFusion: `/model hydrafusion`, types one or more prompts as turns, reads route/models/credits from `~/.copilot/session-state/<id>/events.jsonl`. Needed because `copilot -p --model hydrafusion` is refused (`Error: Model "hydrafusion" from --model flag is not available.`) and setting it as the default model silently falls back to `claude-sonnet-5` with no fusion events | No tests. Two driver bugs were found and fixed during the round (turn-completion check; Enter swallowed after a long "pasted" prompt). Fragile across CLI updates |
| `docs/LADDER.md` | New sections on `--compare-strong`, `--spec-model`, cache exclusion, result folders. **Missing:** the cost caveat that the spec run cost 65 credits (see below) | |

The owner's `~/.copilot/settings.json` was edited once for a probe and restored from a backup; line 25 is `"model": "gpt-5.6-terra"` as before.

## Results on the Pong task, all [MEASURED], one run per cell

Gate for every run: `python3 -m unittest discover -s tests -q` (+ `py_compile`/`compileall`). "Runs" = `tty-smoke.py` passes. "Plays like Pong" = code read of serve velocity and paddle-hit physics, plus the owner's own play-test where noted.

| Arm | Task text | Credits | Runs | Serve | Paddle hit changes angle | Raw |
| --- | --- | ---: | --- | --- | --- | --- |
| 1 Luna attempt (ladder base) | mid-detail `pong.md` | 3.97 | yes | flat (`vy=0`), never bounces | no | `pong1-ladder-compare-strong` |
| Ladder: 2× Luna + Sol arbitration on 9 disputed files (4 were `.pyc`) | mid-detail | 34.45 | yes | flat: Sol kept both attempts' shared mistake | no | same |
| Sol alone | mid-detail | 66.21 | yes | diagonal | no | same |
| Luna alone | one-liner | 6.51 | yes | flat until first off-centre hit | yes | `pong2-luna-vs-sol-one-liner` |
| Sol alone | one-liner | 48.75 | yes | diagonal | yes | same |
| Sol writes spec (65.21) + 1 Luna implements (6.20) | one-liner | 71.41 | **no: `BlockingIOError [Errno 35]` on first draw**; gate was green | diagonal | yes | `pong2-sol-spec-luna` |
| HydraFusion build, run 1 | one-liner | 1.38 | yes | diagonal | no | `pong3-hydrafusion-build` |
| HydraFusion build, runs 2–4 | one-liner | 1.25 / 25.30 / 31.20 | yes (25.30, 31.20 checked) | | | `pong4-…`, `pong5-…` |
| HydraFusion fix of run 1, **fresh session** | owner's 3 complaints | 35.77 | yes | diagonal | yes (`offset * radians(60)`) | `pong3-hydrafusion-fix-fresh-session` |
| HydraFusion build (31.20) + fix in **same session** (70.51) | one-liner then 3 complaints | 101.94 | yes | diagonal | yes | `pong5-hydrafusion-two-turn` |

Owner's play-test of HydraFusion run 1 (1.38 credits): works, computer opponent works, ball looks nicer; but paddle hit changes nothing, paddles draw out of sync, screen flashes. Those three complaints became the fix prompt (`pong3-hydrafusion-build/fix-prompt.txt`). Nobody has play-tested the fixed versions or the Sol-alone versions.

Where the finished code is (not in the repo, on this machine only): `~/scratch/pong-out/{attempt-a,attempt-b,ladder-final,strong-solo}`, `~/scratch/pong2-spec-out/attempt-a`, `~/scratch/pong2-plain-out/{attempt-a,strong-solo}`, `~/scratch/pong3-fusion-out/{attempt,attempt-v2}`, `~/scratch/pong4-fusion-multiturn/attempt`, `~/scratch/pong5-fusion-multiturn/attempt`. Run any with `python3 -m pong`.

## What the Pong round showed

1. **[MEASURED]** Green tests did not mean a working game three times: the flat serve (all Luna-designed versions), the crash on start (spec arm), missing paddle physics (HydraFusion run 1). Only running the program or playing it found these. `tty-smoke.py` catches the crash class for free.
2. **[MEASURED]** The ladder's comparison cannot catch a mistake both cheap attempts share. Both Luna attempts served with `vy=0`; Sol as arbiter kept it. This was a known limit (`docs/LADDER.md`), now demonstrated.
3. **[MEASURED]** Sol writing the spec cost more than Sol building the game (65.21 vs 48.75): it ran simulations and wrote 212 lines of spec + 490 lines of tests. And the spec's phrase "non-blocking key reads" led Luna to set `O_NONBLOCK` on stdin, which on a real tty also makes stdout non-blocking, hence the crash. **[INFERRED]** More spec detail pushes the cheap model into literal compliance and does not substitute for judgment.
4. **[MEASURED]** The same one-line prompt on the same HydraFusion route (`critique`: Luna draft + Terra critic) cost 1.25, 1.38, 25.30 and 31.20 credits. The difference is how much Luna decided to build (7 vs 55 requests, 207 vs 802–1153 lines). Cost grows faster than requests because each request re-sends the whole conversation (8× requests → 14× input tokens).
5. **[MEASURED]** HydraFusion's critic (one Terra request, ~0.2 credits) approved run 1 without running anything: "unavailable verification cannot alone justify revision".
6. **[MEASURED]** HydraFusion routes every turn separately inside one session. The fix prompt went to `single`/`gpt-5.6-sol` in 3 of 3 runs; the build went to `critique`/Luna+Terra in 4 of 4; the owner's one-word "test" went to `single`/Sol (6.58 credits). `followUpModel` in `session.fusion_resolved` is a per-turn default, not a session pin (it changed from Luna to Sol between turns).
7. **[MEASURED]** Same fix prompt, same Sol route: fresh session 35.77 credits (12 requests, 272,907 input of which 31,243 uncached) vs same session after a Luna turn 70.51 (10 requests, 362,849 input of which 117,089 uncached). Output tokens nearly equal (6,803 vs 6,920). **[INFERRED]** The extra cost is Sol reading Luna's history cold; caches are per model. Caveat: the same-session build was also bigger (802 vs 207 lines), so the two causes are not separated.
8. **[MEASURED]** A HydraFusion session can dispatch this repo's custom subagents; `Fleet Explore` ran on its pinned `gpt-5.6-luna` (`subagent.started` event), fusion scope stayed `root`. But the router sent the root turn ("use Fleet Explore to find X") to `claude-opus-5`: 20.71 credits for delegating a lookup. Every route observed had `policy: max`; whether a cheaper policy exists is unknown. Raw: `fusion-subagent-probe`.
9. **[MEASURED]** `experiments/fusion-run.py` does not record subagent credits; only fusion phases.

## Community findings, all [READ], two research subagents 2026-09-21

Sources: GitHub docs/blog, VS Code blog, practitioner blogs, HN via Algolia API (exact text), Reddit via RSS (exact text, no scores, ~17 threads seen by title only). Thread text saved under `handoff/raw/community/<thread-id>.txt`.

Agrees with our measurements:
- Cost is dominated by input tokens re-sent every request; one dissected request had 98% cached tokens that were still ~70% of the bill (kenmuse.com).
- One task per session; new session per task (4+ Reddit users; GitHub and VS Code docs).
- Restrict tools/MCP at launch; tool schemas are paid every request. A lean 3-tool agent: 15 credits/prompt vs 400 for the same setup reading 2k-line files (u/newicn, `1ue783d`).
- Detailed instructions/skills raised burn (u/beragis, 7% of a monthly allowance in 2 h vs <1%; single anecdote, `1txw7h2`).
- Tool-output compressors can raise total tokens: RTK made output shorter but tasks used more tokens on average (GitHub blog per summary; u/Propeus 120k with vs 60k without, `1u4kwyb`). **Bears on `shunt-copilot`: judge it on total task credits, not bytes avoided.**

New, not yet tested here:
- **Luna at `--reasoning-effort xhigh` or `max` as the main model**, frontier model only as validator: 5–10 credits/request vs 90–200 on Sonnet 5 / GPT-5.4 / Codex (5+ users, `1vkq737`). Our only effort test was `low` on Luna, which gave wrong answers 2/3. Secondhand: "Luna Max nearly matches Opus 5 Medium on DeepSWE at ~80% less cost" (u/cesarmalari, `1w78r2a`, unverified).
- **Cache lifetime is much shorter than the docs' 24 h (OpenAI) / 1 h (others)**: observed ~5 min Anthropic, ~30 min GPT-5.6 (staff-like reply, `1uxzcso`), sometimes less. An idle gap past it made the next turn ~12× dearer on the same 87k context ($0.0458 cache read vs $0.5496 cache write, 7 min apart; u/Prestigious_Race_636, `1uxyetk`). Cache write billed ~1.25× input on GPT-5.6 and Anthropic.
- **Fixed floor per CLI turn ~29k tokens** (20.5k system prompt + 8.5k tools; github/copilot-cli issue #2627); "hi there" cost 9.39 credits on a Sonnet-class model (`1twr2s7`). Our own measurement was 11.8k tokens of tool definitions at 38 tools.
- **Repoint the built-in Explore/execution subagent to Luna**: 20–60 credits per explore → 6–10 (`1vre92d`). Known bugs: setting reverts on restart; parent agent can override the subagent model.
- Subagents get none of the parent's cache; each starts cold with its own fixed context.
- Switching *down* to a much cheaper model mid-session may pay despite the cache miss (HN `48916512`, price arithmetic only). We measured only switching *up* (Luna→Sol doubled the fix cost).
- Auto model selection: 10% discount, mostly rejected by users because it can route to a pricier model and shows the choice only afterwards (`1u91x6g`, HN `48370382`).
- HydraFusion user reports are mixed: one Opus-only user "80–90% down"; others "expensive", low context window, session resume failure, no per-leg cost.
- Measurement tools: `gh extension install mazrean/gh-copilot-usage` reads `~/.copilot/session-store.db` and shows per-turn and subagent cost; VS Code "show agent debug logs".
- Not found anywhere: measurements of `--max-ai-credits`, `/compact` vs `/clear`, reasoning effort vs credits on Copilot.

## Open questions, in the order I would take them

| # | Question | How | Rough cost |
| --- | --- | --- | --- |
| 1 | Does Luna at `--reasoning-effort xhigh`/`max` match Sol on `spec-audit-xl` (Sol: 3/3 at 58.74) and on the Pong one-liner? | `experiments/run-exp.mjs` with `--reasoning-effort`; the benchmark may need a flag passed through to `runCopilot` | 30–60 credits |
| 2 | Real cache lifetime on this account: two identical turns 6 min apart vs 35 min apart, Luna and Sol | two `copilot -p --resume` calls per gap, compare `cacheReadTokens` vs `cacheWriteTokens` in the usage files | <5 credits |
| 3 | Does `shunt-copilot` backfire like RTK? | Re-read `handoff/raw/sol-3-arms.json` total credits per task, not bytes; the earlier handoff already shows shunt total 51.06 vs baseline 45.73 | 0 |
| 4 | Down-switch Sol→Luna mid-session: net cost? | one session: hard turn on Sol, then `/model gpt-5.6-luna`, easy turn; compare to the same easy turn in a fresh Luna session | 10–20 credits |
| 5 | Does a tighter prompt narrow HydraFusion's 1–31 credit spread? e.g. "minimal: one module + tests, no CLI options, stop when tests pass" | `experiments/fusion-run.py`, 3 runs | 5–90 credits |
| 6 | `--max-ai-credits` as a cap on open-ended builds | add to `fusion-run.py`/benchmark; check it stops a 31-credit run | ~10 credits |
| 7 | HydraFusion on a task with an answer key (`spec-audit-xl`) | needs `fusion-run.py` pointed at the fixture; compare with Sol 58.74 and ladder 38.61 | 20–60 credits |
| 8 | Add `tty-smoke.py` (or a generic "run it" step) to the ladder's gate and to `docs/LADDER.md`; add the 65-credit spec caveat to `docs/LADDER.md` | code + docs | 0 |
| 9 | Record subagent credits in `fusion-run.py` (`subagent.completed` events carry `totalNanoAiu`?) | code | 0 |

## Things I got wrong during the round, so you do not repeat them

- I estimated Sol's spec would cost 3–10 credits; it cost 65.21.
- I reported a "Sol `single` route stall" that was my pty driver failing to submit a long prompt (the CLI treats fast-typed long text as a paste and swallows the Enter). Fixed in `fusion-run.py` by confirming a `user.message` event and re-pressing Enter.
- I first guessed HydraFusion pins the turn-1 model for the session; the two-turn run showed it re-routes every turn.
- I said "1.38 credits builds Pong". Across 4 runs the same prompt cost 1.25–31.20, and the 1.38 build needed a 35.77-credit fix to be playable.
