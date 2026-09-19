# Measuring whether Shunt helps in Copilot

This benchmark asks Copilot CLI the same question twice: once normally, once with this plugin loaded. It then compares what each run really cost. Every number comes from Copilot CLI's own usage report (`--usage-output-file`). Nothing is estimated from file sizes.

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
```

Leave out `--model` to use your Copilot CLI default. A full run takes about five minutes.

## Options

| Option | What it does | Default |
| --- | --- | --- |
| `--model <id>` | Main model for both runs | Your CLI default |
| `--scenario <name>` | Run only one scenario | All five |
| `--runs <n>` | Repeat each run `n` times and report the median | `1` |
| `--arm baseline` or `--arm shunt` | Run only one side | Both |
| `--out <folder>` | Where to keep results | A new temp folder |
| `--timeout-sec <n>` | Give up on one session after `n` seconds | `600` |
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
| Worker in / Worker out | Tokens the cheap worker model read and wrote |
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

## First measured run

One run per side on 2026-09-19, Copilot CLI on macOS, with `gpt-5.6-luna` as both main and worker model. This is a single sample with a cheap main model, so treat it as a first look, not a verdict. All ten answers passed their checks.

| Scenario | AI credits | Main input tokens | Main output tokens | Main model calls | Time |
| --- | --- | --- | --- | --- | --- |
| find-a-value | -25% | -16% | -9% | 0% | -1% |
| mid-size-file | +59% | +31% | +59% | +33% | +82% |
| summarise-big-file | +87% | +15% | +54% | +88% | +479% |
| cross-file-question | +161% | +17% | +82% | +20% | +186% |
| generate-tests | +96% | +195% | +68% | +200% | +443% |

In this run the plugin cost more in every scenario where it delegated. The transcripts show why:

- Copilot CLI sends roughly 12,000 tokens of fixed context with every model call. A blocked read, a skill load and a helper call add three or more calls, which outweighs the 1,500 tokens the 6 KB file would have cost.
- Each delegation is a second Copilot session. It starts cold, so it pays for its own fixed context and the files at the uncached rate.
- Without the plugin, Copilot already avoided whole-file reads of the big file by using `rg` and small ranges.
- In `generate-tests` the model could not find `code-write.mjs` from the skill text and spent several calls searching the disk for it. `find-a-value` never delegated; its difference is run-to-run noise.

The reported credits matched a hand calculation from GitHub's published per-token prices in all five scenarios, so the figure is the real bill. Re-pricing the same token counts with `gpt-5.6-sol` as the main model gives -25%, +11%, -1%, +24% and +59%: closer, because the worker's share shrinks, but still no saving. That is arithmetic on a Luna run, not a Sol run, so run it with your own main model before drawing a conclusion.

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
