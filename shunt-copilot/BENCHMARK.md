# Measuring whether Shunt helps in Copilot

This benchmark asks Copilot CLI the same question in up to four ways and compares what each run really cost:

- `baseline` — plain Copilot CLI
- `shunt` — this plugin loaded
- `fleet` — the repository's Subagent Fleet coordinator, which hands work to cheap subagents inside the same session
- `economy` — direct Luna execution with the standalone Economy profile, including edits and checks
 Every number comes from Copilot CLI's own usage report (`--usage-output-file`). Nothing is estimated from file sizes.

The fleet now allows Sol to handle small tasks directly and delegate selectively.
See [the revised-fleet measurements](../docs/SELECTIVE-FLEET-RESULTS.md). Results
below describe the earlier delegation-only fleet. Long-session checks now validate
each answer separately, so later facts cannot hide an unanswered earlier question.

## Before you start

You need:

- Node 20 or newer (`node --version`)
- Copilot CLI, logged in (`copilot --version`, then `copilot login` if needed)
- Access to the worker model in `config.json` (default `gpt-5.6-luna`)

The benchmark sends real requests, so it uses your Copilot allowance. The default run is 10 main sessions plus one worker session for each delegation.

## Run it

From the `shunt-copilot` folder:

```sh
# 1. See what would run. Sends nothing, costs nothing.
node scripts/benchmark.mjs --dry-run

# 2. Try one cheap scenario first (2 sessions).
node scripts/benchmark.mjs --scenario mid-size-file

# 3. Run everything with the model you normally use.
node scripts/benchmark.mjs --model <your-main-model-id>

# 4. Compare all three approaches. The fleet coordinator is pinned to gpt-5.6-sol,
#    so give the other two the same model.
node scripts/benchmark.mjs --model gpt-5.6-sol --arm baseline,shunt,fleet
```

Leave out `--model` to use your Copilot CLI default. A full run takes about five minutes.

## Test your own repository

The built-in project is tiny. To see what happens on your real work, give it a repository and a text file of questions, one per line, in the order you would ask them:

```sh
node scripts/benchmark.mjs --model gpt-5.6-sol --arm baseline,fleet \
  --project /path/to/your/repo --prompts my-questions.txt
```

Each side works in its own throwaway `git clone` of the committed state, so your checkout is never touched. The questions run as one conversation. Answers are not checked automatically: read `answers.md` in each run folder and compare them yourself.

## Options

| Option | What it does | Default |
| --- | --- | --- |
| `--model <id>` | Main model for baseline and Shunt; fleet pins Sol and economy pins Luna | Your CLI default |
| `--scenario <name>` | Run only one scenario. `long-session` asks eight questions in one conversation and only runs when named | The five single questions |
| `--runs <n>` | Repeat each run `n` times and report the median | `1` |
| `--arm <list>` | Comma-separated sides to run: `baseline`, `shunt`, `fleet`, `economy` | `baseline,shunt` |
| `--out <folder>` | Where to keep results | A new temp folder |
| `--timeout-sec <n>` | Give up on one session after `n` seconds | `600` |
| `--project <path>` with `--prompts <file>` | Use your own git repository and questions instead of the built-in ones | Off |
| `--dry-run` | Print the plan and stop | Off |

Model answers vary from run to run. Use `--runs 3` before you trust a small difference.

## The scenarios

Each run gets a fresh copy of a small generated project, so runs cannot affect each other.

| Scenario | What Copilot is asked | How the answer is checked |
| --- | --- | --- |
| `find-a-value` | Find a retry limit inside a 1,700-line, 69 KB file | Answer contains `7`, `250` and `retryDelivery` |
| `mid-size-file` | Find the biggest discount in a 485-line, 6 KB file | Answer contains `SKU-077`, `40` and `platinum` |
| `summarise-big-file` | Summarise the 69 KB file | Answer names the first and last topic and `retryDelivery` |
| `cross-file-question` | Answer a question that spans three files | Answer names the three linked functions |
| `generate-tests` | Write tests for a class, copying a reference test file | The new test file exists and `node --test` passes on it |

`mid-size-file` matters most. Copilot CLI's own `view` tool already refuses whole files somewhere between 16 and 20 KB (measured on this machine; it replies "File too large to read at once"). So for big files Copilot is already protected without the plugin. A long file with short lines slips under that limit, and there only the plugin steps in.

## Reading the results

The first table has one row per scenario and side:

| Column | Meaning |
| --- | --- |
| Main in / Main out | Tokens the main (expensive) model read and wrote |
| Worker in / Worker out | Tokens the cheap helpers read and wrote: Shunt's worker sessions and the fleet's subagents |
| Main calls | How many times the main model was called. Each call resends the whole conversation |
| AI credits | What Copilot bills, main and worker together. One credit is $0.01. The CLI reports it as `totalNanoAiu`, in billionths of a credit |
| Seconds | Wall-clock time |
| Delegated | In how many runs the worker was actually called |
| Correct | In how many runs the answer passed its check |

The second table shows the change with the plugin. Negative means the plugin used less.

How to judge it:

- **AI credits** is what you pay. Copilot bills tokens at each model's price, and this figure includes the worker, so it is the honest bottom line. GitHub's [pricing reference](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) (checked 2026-09-19) prices every model per million tokens and sets one AI credit at $0.01. Request-based billing with model multipliers now applies only to Pro and Pro+ subscribers who stayed on a legacy annual plan after 2026-06-01. The CLI still prints a "premium requests" counter, which the benchmark ignores.
- **Main model calls** explains most of the cost. Every call carries about 12,000 tokens of fixed context before any file is read.
- **Main input tokens** shows how much was kept out of the main model's context. This is the number Spotify's 90% claim is about.
- **Delegated 0/1** means the plugin never sent anything to the worker in that run, usually because the model searched with `rg` instead of reading. Then both sides cost about the same, and the plugin neither helped nor hurt.
- **Correct** dropping on the plugin side means the saving cost you answer quality.

## Measured runs

Both runs were one sample per side on 2026-09-19, Copilot CLI on macOS, worker `gpt-5.6-luna`. One sample is noisy: `find-a-value` under Shunt never delegated, so it did the same work as the baseline, yet it came out 31% cheaper. Treat any difference under about a third as noise until you repeat it with `--runs 3`.

### Main model `gpt-5.6-sol`, all three approaches

AI credits per scenario, workers and subagents included:

| Scenario | baseline | shunt | fleet |
| --- | ---: | ---: | ---: |
| find-a-value | 5.96 | 4.12 | 6.33 |
| mid-size-file | 4.63 | 12.86 | 3.60 (answer failed its check) |
| summarise-big-file | 17.68 | 8.10 | 7.49 |
| cross-file-question | 5.86 | 5.92 | 6.34 |
| generate-tests | 11.61 | 20.07 | 24.13 |
| **Total** | **45.73** | **51.06 (+12%)** | **47.89 (+5%)** |
| Total time | 107 s | 249 s | 762 s |

What the transcripts show:

- Neither approach saved money overall. Both won clearly in one place: summarising a big file, where the baseline needed 82,000 main-model input tokens and the others needed 40,000 (Shunt) and 17,000 (fleet).
- The fleet keeps the expensive model's share small and steady, about 16,000 input tokens and two calls, because the coordinator only dispatches and reads a summary. Its subagents are cheap per token but read a lot: 165,000 to 478,000 tokens in the larger scenarios.
- The fleet lost on `generate-tests` because of who it dispatched. A Gemini 3.8 Flash implementation agent made 18 calls for 10.4 credits and a second Sol agent added 3.5, on top of 9.0 for the coordinator.
- Shunt lost where delegation added main-model calls: 2 to 7 calls on `mid-size-file` and 4 to 9 on `generate-tests`. Every call carries about 12,000 tokens of fixed context, and the 6 KB file it avoided is only about 1,500 tokens.
- Copilot CLI already refuses whole-file reads above roughly 16 to 20 KB, so the baseline handled the 69 KB file with `rg` and small ranges.
- The fleet's failed check on `mid-size-file` comes from the prompt: it answered "which tiers exist" for SKU-077 only. The discount answer was right.
- The fleet is much slower, 7 times the baseline in total.

### One long session on `gpt-5.6-sol`

Eight questions in a single conversation (`--scenario long-session`), so everything read early is carried by every later call. All three sessions answered correctly.

| | baseline | shunt | fleet |
| --- | ---: | ---: | ---: |
| AI credits, total | 44.84 | 54.30 (+21%) | 49.72 (+11%) |
| of which Sol | 44.84 | not split | 34.04 (-24%) |
| of which cheap helpers | 0 | not split | 15.68 (10 Luna subagents) |
| Sol input tokens | 422,363 | 573,701 (+36%) | 229,506 (-46%) |
| Helper input tokens | 0 | 58,452 | 1,729,184 |
| Context size at the last call | 33,058 | 30,961 | 18,158 |
| Time | 105 s | 258 s | 682 s |

The fleet does what it promises for the expensive model: Sol read 46% fewer tokens, cost 24% less, and its context stayed almost half the size. The coordinator's briefs were small and specific, around 500 characters such as "Read only src/pricing-rules.mjs. Determine which SKU has the largest discount". The total still came out 11% higher because of how the subagents read. Copilot CLI will not return the 69 KB file in one go, so a subagent pages through it in ranges, and every call resends what it has gathered so far: four subagents made 18 to 22 calls and resent about 350,000 tokens each. Nearly all of that is cached, so one subagent costs only 0.1 to 3.6 credits, but ten of them add up to 15.68. At eight questions the baseline's context was only 33,000 tokens, so the carried-context cost the fleet avoids was still small. A longer session on a larger repository shifts this in the fleet's favour, and narrower subagent briefs would shrink its helper bill; neither has been measured here.

### Main model `gpt-5.6-luna`, baseline against Shunt

With a cheap main model there is nothing expensive to protect, and Shunt cost more wherever it delegated: +59%, +87%, +161% and +96% AI credits across the four delegating scenarios, with all ten answers correct. The reported credits matched a hand calculation from GitHub's published per-token prices in all five scenarios, so the figure is the real bill.

## Where the files go

The last line of output prints the results folder. It holds:

- `report.md` — the two tables
- `results.json` — every number, per run
- `<scenario>-<arm>-<run>/transcript.jsonl` — everything Copilot did in that run
- `<scenario>-<arm>-<run>/project/` — the project after the run, including generated tests

Delete the folder when you are done.

## What this does not tell you

- The project is small and synthetic. A large real repository can behave differently.
- One run per side is a sample, not a proof.
- It measures Copilot CLI only. VS Code and the Copilot app may read files differently.
- Both sides run with `--allow-all-tools --allow-all-paths` inside the throwaway project, and with your custom instructions switched off, so the two sides are compared fairly.
