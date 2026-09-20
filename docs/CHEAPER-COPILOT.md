# Cheaper Copilot: what to use and how to test it yourself

This is the practical page. It says what to change in day-to-day Copilot CLI use,
how to try each change on your own repository, and how to reproduce the numbers.
The full measurements, including everything that did not work, are in
[COST-EXPERIMENTS-RESULTS.md](COST-EXPERIMENTS-RESULTS.md). The escalation tool
has its own page, [LADDER.md](LADDER.md).

All costs are AI credits from the CLI's own usage file; 1 credit is $0.01. The
figures come from three to five runs per configuration on synthetic fixtures with
Copilot CLI 1.0.86, so treat them as a screening result and check them on your own
work with the commands below.

## The three things that held up

| # | Change | Measured effect | Catch |
| --- | --- | --- | --- |
| 1 | Restrict the tool list | -53% on a long Luna session, -20% on Sol, answers unchanged | No saving on a single short task; a task that needs another tool fails outright |
| 2 | Work-method prompt (`experiments/prompts/checklist.md`) in front of a large task on the cheap model | Luna goes from 0/3 to 3/3 on the hard benchmark at 18.98 credits against Sol's 58.74 | About six times more model calls, so slower; right 5 times in 6, not always |
| 3 | The ladder (`experiments/ladder.mjs`) when a silent miss would be expensive | Accepted 4/4 at about 30 to 39 credits | Twice the cost of one attempt; two attempts can still agree on a mistake |

What did **not** help, so you do not need to try it again: disabling MCP servers
(-669 tokens only), `--reasoning-effort low` (wrong answers in 2 of 3 runs),
`mai-code-1.1-flash` (+28%), `--auto-tier efficiency` (+42% in its one run), a
strong-model review of the cheap model's whole diff, and the subagent fleet.

## 1. Restrict the tool list

Every model call re-sends the description of every available tool. By default
that is 38 tools and 11,768 tokens before anything is read; with five tools it is
5,189 tokens.

```sh
copilot --model gpt-5.6-luna --available-tools view rg glob bash apply_patch
```

The same flag works with `-p` for scripted use and with any model. The five tools
cover reading, searching, shell and editing. If a session needs an MCP server,
`task`, `skill`, `sql` or `web_fetch`, add that tool's name to the list or drop the
flag for that session.

See the effect on your own machine, for a fraction of a credit each:

```sh
node experiments/run-exp.mjs --id MY --variant ctx-default -- \
  --model gpt-5.6-luna --arm baseline --scenario context-probe
node experiments/run-exp.mjs --id MY --variant ctx-tools -- \
  --model gpt-5.6-luna --arm baseline --scenario context-probe \
  --tools view,rg,glob,bash,apply_patch
```

The "1st-call in" column of each report is the starting context in tokens.

## 2. The work-method prompt

`experiments/prompts/checklist.md` is seven lines that make the model enumerate
every unit and rule before changing anything, check each unit against its own
sources rather than a similar neighbour, re-verify everything afterwards, and not
claim completion until every cell is checked. It is for large, many-file,
audit-style tasks. On small tasks it only adds calls.

The tested way to use it is to put it in front of the task text:

```sh
copilot --model gpt-5.6-luna --available-tools view rg glob bash apply_patch \
  -p "$(cat experiments/prompts/checklist.md)

<your task here>" --allow-all-tools
```

Putting the same text into a custom agent profile or an instructions file should
work the same way, but that route has not been measured here.

## 3. The ladder, on your own repository

```sh
# 1. See the plan. Costs nothing.
node experiments/ladder.mjs --repo /path/to/repo --task-file task.md \
  --setup "npm ci" --gate "npm test" --dry-run

# 2. Run it. Your checkout is not touched; work happens in throwaway clones of the committed state.
node experiments/ladder.mjs --repo /path/to/repo --task-file task.md \
  --setup "npm ci" --gate "npm test" --out /tmp/ladder-task-1

# 3. Read the verdict and the credits it prints, review the patch, then apply it yourself.
git -C /path/to/repo apply --index /tmp/ladder-task-1/result.patch
```

`task.md` holds the task exactly as you would give it to an agent. `--setup` and
`--gate` are your repository's own install and check commands. Commit or stash
anything the task depends on first, because uncommitted changes are not cloned.
Verdicts, options and limits are in [LADDER.md](LADDER.md).

## Compare models on your own repository

To see what a session costs on each model with your own questions, put one prompt
per line in a file and run:

```sh
node experiments/run-exp.mjs --id MY --variant sol-myrepo -- \
  --model gpt-5.6-sol --arm baseline --project /path/to/repo --prompts questions.txt \
  --tools view,rg,glob,bash,apply_patch --runs 3
node experiments/run-exp.mjs --id MY --variant luna-myrepo -- \
  --model gpt-5.6-luna --arm baseline --project /path/to/repo --prompts questions.txt \
  --tools view,rg,glob,bash,apply_patch --runs 3
```

Nothing can check those answers automatically. The answers of each run are in
`handoff/runs/exp-MY-<variant>/<run>/answers.md`; read them before believing a
saving. Use at least three runs: identical runs differed by up to 1.7 times in
cost, depending on how much was served from cache.

## Reproduce the benchmark numbers

Add `--dry-run` after the `--` to any of these to see the plan without spending.

| What | Command (after `node experiments/run-exp.mjs --id R --variant <new name> --`) | Rough cost |
| --- | --- | ---: |
| Tool restriction, long session | `--model gpt-5.6-luna --arm baseline --scenario long-session --runs 3` then the same with `--tools view,rg,glob,bash,apply_patch` | 16 + 8 |
| Hard benchmark, Sol | `--model gpt-5.6-sol --arm baseline --scenario spec-audit-xl --runs 3 --tools view,rg,glob,bash,apply_patch` | 175 |
| Hard benchmark, plain Luna | same with `--model gpt-5.6-luna` | 20 |
| Hard benchmark, Luna with the prompt | same plus `--prompt-prefix-file experiments/prompts/checklist.md` | 57 |
| Ladder arm | `--arm ladder --scenario spec-audit-xl --runs 3 --prompt-prefix-file experiments/prompts/checklist.md --tools view,rg,glob,bash,apply_patch` | 115 |

`run-exp.mjs` writes one record per run to `handoff/raw/exp-<id>-<variant>.json`,
appends a row to `experiments/LEDGER.md`, and refuses a variant name that already
exists, so earlier results are never overwritten. In zsh, pass options literally
or through an array; a plain `$VAR` holding several options is not split into
words and the run fails at argument parsing without spending anything.

Checks that cost nothing:

```sh
node --test shunt-copilot/tests/*.test.mjs tests/*.test.mjs experiments/tests/*.test.mjs
node experiments/spec-audit/validate.mjs       # proves the small grader
node experiments/spec-audit-xl/validate.mjs    # proves the large grader
```

## Where everything is

| Path | What it is |
| --- | --- |
| `docs/COST-EXPERIMENTS.md` | The original work order: the ideas to test |
| `docs/COST-EXPERIMENTS-RESULTS.md` | Every measurement, including failures and caveats |
| `docs/LADDER.md` | The escalation tool: usage, verdicts, limits |
| `experiments/ladder.mjs` | The escalation tool |
| `experiments/prompts/checklist.md` | The work-method prompt |
| `experiments/run-exp.mjs` | Append-only runner around the benchmark |
| `experiments/LEDGER.md` | One row per live run, never edited |
| `experiments/spec-audit-xl/` | Generator and grader for the benchmark that separates the model tiers |
| `shunt-copilot/scripts/benchmark.mjs` | The benchmark: scenarios, arms, cost buckets |
| `handoff/raw/exp-*.json` | Per-run records |
| `handoff/runs/` | Transcripts and generated projects; local only, not committed |
