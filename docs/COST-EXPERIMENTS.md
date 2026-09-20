# Cost experiments: work order

This is a task list for an agent. Work through the experiments in order. Each
one tests a single idea for lowering the GitHub Copilot bill. Your job is to
measure, not to argue: run it, record the numbers, move on.

## Background you need

Copilot bills tokens as AI credits (1 credit = $0.01) at each model's published
price. Three earlier attempts in this repository (the Subagent Fleet, the Shunt
plugin, a selective fleet) did not lower the total bill. Read
`handoff/HANDOFF.md` for the details. The short version:

- A plain eight-question session on `gpt-5.6-sol` cost 44.84 credits. Split by
  price bucket: 51% uncached input, 33% cached input, 16% output.
- The earlier attempts only reduced the cached bucket, which is already
  discounted 10x, and added cold subagent sessions that pay full price.
- Every model call carries 12,000 to 14,000 tokens of fixed context (system
  prompt, tool schemas) before any file is read. Over 17 calls that was about
  31% of the bill.
- The same session on `gpt-5.6-luna` cost 6.37 credits, and 77% of that was
  cache-write charges.

Prices per million tokens are in `docs/MODEL-COSTS.md`.

## Rules

1. Do not change `.github/agents/`, `.github/fleet/`, `shunt-copilot/hooks/`,
   `shunt-copilot/skills/` or `scripts/install.mjs`. Experiments go in
   `shunt-copilot/scripts/benchmark.mjs` (new arms or options), in new files
   under `experiments/`, and in this document's results table.
2. One experiment at a time. Change one thing per experiment against the
   baseline. If you change two things you cannot tell which one worked.
3. Live runs cost real money. Total budget for this whole document is
   **400 credits ($4)**. Keep a running total in the results table. Stop and
   report when you reach it.
4. Always run `node shunt-copilot/scripts/benchmark.mjs --dry-run ...` first
   and read the plan before a live run.
5. Use `--runs 3` and compare medians. A difference under 15% between medians
   is noise. Say "no measurable effect" in that case.
6. A run whose answer check fails does not count as a saving. Record it as
   failed, with its cost.
7. Cost means `totalNanoAiu / 1e9` from the CLI's usage file, all agents and
   workers included. Never estimate from file sizes or character counts.
8. After any change to `benchmark.mjs`, run
   `node --test shunt-copilot/tests/*.test.mjs tests/*.test.mjs`. Add a unit
   test for new parsing or arithmetic. Do not run a live benchmark with failing
   tests.
9. If something cannot be done (a flag does not exist, a model is not enabled
   on this account), write down the exact error text under that experiment and
   go to the next one. Do not invent a workaround that changes what is tested.
10. Check CLI flags with `copilot --help` before using them. Several flags in
    this document came from web pages that were not re-read. They are marked
    "unverified".

## How the benchmark works today

`shunt-copilot/scripts/benchmark.mjs`, documented in
`shunt-copilot/BENCHMARK.md`. Arms: `baseline`, `shunt`, `fleet`, `economy`.
Each run gets a fresh throwaway project. `runCopilot()` builds the CLI
arguments; every arm already runs with `--no-custom-instructions` and
`--disable-builtin-mcps`. User-configured MCP servers are still loaded.

Two scenarios are used below:

- `long-session`: eight questions in one conversation. Reference: plain Sol
  about 45 to 56 credits, plain Luna about 2.4 to 6.4.
- `generate-tests`: one implementation task with a real pass/fail check.
  Reference: plain Sol median 11.37, Economy (Luna) median 0.71.

Baseline command for both:

```sh
node shunt-copilot/scripts/benchmark.mjs --model gpt-5.6-sol \
  --arm baseline --scenario long-session --runs 3
node shunt-copilot/scripts/benchmark.mjs --model gpt-5.6-sol \
  --arm baseline --scenario generate-tests --runs 3
```

Run the baselines once at the start (Experiment 0) and reuse those numbers.
Do not re-run the baseline for every experiment.

## Step 0: cost breakdown in the report

Before any experiment, extend the benchmark report so every run shows credits
split into four buckets: uncached input, cached input, cache write, output.
Compute each from the usage file's `tokenDetails` (`input`, `cache_read`,
`cache_write`, `output`) times the price in `docs/MODEL-COSTS.md`. The four
buckets must sum to `totalNanoAiu / 1e9` within 1%; assert that in a unit test
using `handoff/raw/luna-long-session-baseline-usage.json` (expected total
6.374). Also report the number of model calls and `lastCallInputTokens`.

This needs no live run. Every later experiment is judged by which bucket moved.

## Experiments

Each experiment lists the idea, what to build, the command shape, and what
result would count as a win.

### E0. Baselines

Run the two baseline commands above with `--runs 3`. Also run
`--model gpt-5.6-luna --arm baseline` on both scenarios. Record medians and the
bucket split. Expected spend: about 200 credits for Sol, 25 for Luna. This is
half the budget, so do it once and carefully.

### E1. Smaller fixed context

Idea: fewer tool schemas in the prompt means fewer tokens on every call.

Build: add a benchmark option `--cli-args "<extra args>"` that appends raw
arguments to the `copilot` command for the baseline arm, and an arm label so
results stay separate (for example `--arm baseline --label slim`).

Test, each against the E0 Sol baseline:

- a. Disable every user-configured MCP server:
  `--disable-mcp-server <name>` once per server. List servers first with
  `copilot mcp list` or the CLI's equivalent.
- b. Restrict tools to what the scenario needs: `--available-tools` with only
  the file view, search, shell and edit tools (unverified flag; check
  `copilot --help` for the exact name and tool identifiers).
- c. a and b together.

Measure: input tokens of the first call in a session (the fixed context) and
total credits. Win: fixed context down by 3,000 tokens or more and median
credits down by 15% or more, answers still correct.

### E2. Cheap model with no cache-write charge

Idea: on Luna, cache writes were 77% of the bill. `MAI-Code-1.1-Flash` and
`gpt-5.4-nano` list the same input price with no cache-write charge.

Test: `--model <id> --arm baseline` on both scenarios, against the E0 Luna
baseline. Find exact model ids with `copilot --help` or the model picker.

Win: median credits 15% or more below Luna with all checks passing. Record the
bucket split either way; if these models simply bill uncached input instead,
say so.

### E3. Auto model selection

Idea: GitHub reportedly gives 10% off when the model is chosen by Auto
(unverified).

Test: run the baseline arm with the model set to Auto (find the right value;
it may be `--model auto` or omitting `--model` with Auto as the CLI default).
Record which model each run actually used (`currentModel` and `modelMetrics`
in the usage file) and the credits.

Win: same model as a pinned run, at lower credits. If Auto picks a different
model each time, report the distribution and stop.

### E4. Idle gaps and cache expiry

Idea: real sessions have pauses. If the prompt cache expires during a pause,
the whole context is billed again at the uncached price, 10x more. The
benchmark sends prompts back to back and never sees this.

Build: add `--turn-gap-sec <n>` that sleeps between turns of `long-session`.

Test on `gpt-5.6-luna` only (cheap): gaps of 0, 360, 2100 and 3900 seconds,
one run each. These take hours of wall time; run them in the background. For
each turn record `cache_read` and uncached `input` tokens.

Report: the gap at which `cache_read` drops to near zero on the next turn.
That is the real cache lifetime. Then repeat the two gaps on either side of
that boundary with `gpt-5.6-sol`, one run each, to see whether Sol differs.

Follow-up if the cache does expire: measure whether sending `/compact` as the
last prompt before the gap makes the post-gap turn cheaper than doing nothing.

### E5. Cheap main model, expensive consultant

Idea: the reverse of the fleet. Luna runs the whole session and owns the
context. Sol is called rarely, with a small written brief, only for hard
decisions.

Build: a new agent profile in `experiments/agents/consult.agent.md` pinned to
`gpt-5.6-luna` with read, search, edit and execute tools. Its instructions:
when stuck on a design decision or after two failed attempts at the same
check, write a brief of at most 1,500 characters to a file and run
`copilot -p "$(cat brief.txt)" --model gpt-5.6-sol --available-tools ""`
(no tools, answer only), then continue with the answer. Add a benchmark arm
`consult` that installs this profile into the throwaway project. Collect the
consultant's usage with `--usage-output-file` into the worker usage directory
so its cost is counted, the same way the Shunt worker's is.

Test: both scenarios, plus the broader test-generation prompt in
`handoff/raw/selective-fleet-bulk-prompt.txt`.

Record: how often the consultant was called, its cost, total cost, check
results. Compare against E0 Luna (is the consultant worth its cost?) and E0
Sol (how much cheaper is the whole thing?).

### E6. Plan in one session, execute in another

Idea: a strong model writes a plan file once. A cheap model executes it in a
fresh session. No subagents, no shared context.

Build: a benchmark arm `plan-execute` that runs two sessions per task:
first `--model gpt-5.6-sol` with the task prompt plus "Do not edit files.
Write a plan of at most 40 lines to PLAN.md: files, steps, acceptance checks."
Then `--model gpt-5.6-luna` with "Implement PLAN.md. Run the checks." Sum both
sessions' credits.

Test: `generate-tests` and the broader test-generation prompt. Questions-only
scenarios make no sense here; skip `long-session`.

Win: total below E0 Sol by 30% or more with checks passing. Also compare with
E0 Luna: if Luna alone passes the same checks, the plan added cost for nothing
on this task. Say that plainly if so.

### E7. Tool-output compression

Idea: tool output enters the context uncached and is then re-read on every
later call. Shorter output saves twice.

Test a: instruction-only. A profile pinned to `gpt-5.6-sol` whose only extra
instruction is: prefer `rg -n --max-count 20`, pipe long command output
through `tail -n 40`, use quiet flags for test runners, never print whole
files over 200 lines.

Test b: check whether a `postToolUse` hook can replace a tool's output before
the model sees it. Read the hooks documentation through
`npx ctx7@latest library "GitHub Copilot CLI" "postToolUse hook modify tool result"`.
If it can, write a hook that truncates any tool result over 8,000 characters
to its first and last 3,000 with a marker line between. If it cannot, record
that and skip b.

Win: uncached input bucket down by 20% or more, checks passing.

### E8. Fewer, larger calls

Idea: cost in the cached bucket is calls times context size. Seventeen calls
for eight questions is a lot.

Build: `experiments/context-pack.mjs`, a script that prints a compact map of a
repository: file list with sizes, and for each source file its exported
function and class names with line numbers. Keep the output under 6,000
characters for the fixture project.

Test: an arm `packed` where the script's output is prepended to the first
prompt of the session, with the instruction "Use this map to go straight to
the right lines. Batch independent tool calls in one turn."

Win: model calls down by 30% or more and median credits down by 15% or more.
If calls drop but credits do not, report that; the map itself costs tokens.

### E9. Output limits

Idea: output is the most expensive token, 5x to 8x the input price.

Test: baseline arm with a one-line instruction appended to every prompt:
"Answer in at most 5 lines. No preamble. No summary of what you did."
If the CLI has a reasoning-effort option, test the lowest setting as a second
variant.

Win: output bucket down by 40% or more with checks passing. The ceiling here
is small (output was 16% of the Sol bill), so record it and move on.

### E10. No-tools profile for plain questions

Idea: agent mode sends every tool schema on every call. A question that can be
answered from a supplied context bundle needs none of them.

Build: an arm `ask` that runs `experiments/context-pack.mjs` plus the full text
of any file under 8 KB into the prompt and starts the CLI with an empty tool
list.

Test: `long-session` only. Expect some answers to fail, because the large file
does not fit. Record cost per correct answer, not just total cost.

### E11. Instruction files

The benchmark runs with `--no-custom-instructions`, so it cannot see this cost.

Test: run the E0 baseline once more on `gpt-5.6-luna` without
`--no-custom-instructions`, inside a project that contains this repository's
`.github/copilot-instructions.md` and `AGENTS.md`. The difference in first-call
input tokens is the per-call cost of the instruction files. No further action;
just report the number.

## Do not test these

They were measured or are documented as losing, and re-testing wastes budget:

- Switching models between prompts inside one session. It discards the prompt
  cache.
- Fanning out several subagents in parallel.
- Making the Sol coordinator delegate more. It chose not to in every run of
  `docs/SELECTIVE-FLEET-RESULTS.md`.
- LSP or semantic-search tools as a token saver.

## Results table

Fill in one row per variant. Keep failed and skipped experiments in the table.

| Exp | Variant | Scenario | Model | Runs | Median credits | vs baseline | Uncached | Cached | Cache write | Output | Calls | Checks passed | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| E0 | baseline | long-session | gpt-5.6-sol | | | | | | | | | | |

Running total of credits spent: 0 / 400

## Final report

When the budget is spent or every experiment is done, add a section here with:

1. The variants that won, ranked by credits saved, with the exact command or
   profile that reproduces each.
2. The variants that made no measurable difference.
3. The variants that cost more or broke answers.
4. Anything that could not be tested, with the exact error.
5. Which winners can be combined, and one combined run of the best two or
   three to check that the savings add up rather than overlap.

Write the raw per-run JSON to `handoff/raw/exp-<id>-<variant>.json`.
