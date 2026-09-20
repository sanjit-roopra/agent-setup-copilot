# Ladder: cheap model first, strong model only where it is needed

`experiments/ladder.mjs` runs a task on a cheap Copilot model twice, compares the
two results, and pays for the strong model only on the files where the two
attempts disagree. It needs no answer key, so it works on real repositories, not
only on benchmarks. The measurements behind it are in
`docs/COST-EXPERIMENTS-RESULTS.md`, follow-ups 3 and 4.

## Quick start

```sh
node experiments/ladder.mjs \
  --repo /path/to/your/repo \
  --task "Describe the task exactly as you would give it to an agent" \
  --setup "npm ci" \
  --gate "npm test"
```

Check the plan first without spending anything by adding `--dry-run`. For a long
task description use `--task-file task.md` instead of `--task`.

When it finishes it prints a verdict, the credits spent per step, and the path of
a patch. Nothing is applied for you. Review the patch, then:

```sh
git -C /path/to/your/repo apply --index /path/to/out/result.patch
```

## What it does

1. Clones the repository's committed state twice into a throwaway directory. Your
   checkout is never modified. Uncommitted changes are not seen; commit or stash
   what the task depends on.
2. Runs `--setup` in each clone, then `--gate` once to record whether the gate was
   green before any change.
3. Runs the task on the cheap model in both clones at the same time, in separate
   sessions that cannot see each other, each with the work-method prompt from
   `experiments/prompts/checklist.md` in front of the task.
4. Runs `--gate` in both clones and compares the two results file by file.
5. Decides:

| Situation | What happens | Verdict |
| --- | --- | --- |
| Both attempts agree and the gate passes | Nothing more; no strong-model call | `ACCEPTED` |
| They disagree on up to `--max-disputed` files (default 12) | The strong model gets only those files, with the second version alongside, and settles them; the gate runs again | `ARBITRATED`, or `NEEDS HUMAN` if the gate is red |
| They disagree on more than that, or both fail the gate without differing | The cheap attempts are treated as failed and the strong model does the task from scratch in a third clone | `STRONG MODEL`, or `NEEDS HUMAN` if the gate is red |
| The same, with `--no-fallback` | Stops without calling the strong model | `STOPPED` |

The exit code is 0 for `ACCEPTED`, `ARBITRATED` and `STRONG MODEL`, 2 for
`NEEDS HUMAN` and `STOPPED`, and 1 for a usage or setup error.

## What it costs and how reliable it is

Measured on the `spec-audit-xl` benchmark (24 near-identical modules, 14 hidden
specification violations, graded by a held-out oracle that played no part in the
ladder's decisions), credits per task, 1 credit = $0.01:

| Configuration | Accepted | Median credits |
| --- | --- | ---: |
| Strong model alone (`gpt-5.6-sol`) | 3/3 | 58.74 |
| Ladder (this tool, defaults) | 3/3 | 38.61 |
| One cheap attempt with the work-method prompt | 5/6 | 18.98 |
| Ladder with `--no-checklist` | 3/5 | 27.53 |

So the ladder is insurance, not the cheapest option. One cheap attempt with the
work-method prompt costs half as much and was right five times in six; the ladder
caught the sixth. Use the ladder where a silent miss is expensive, a single
scaffolded attempt for routine work, and the strong model directly for changes
where even a small risk is unacceptable.

## What it cannot do

- **Two attempts can agree on the same mistake.** Comparison only finds mistakes
  the attempts do not share. The work-method prompt is what keeps their mistakes
  independent, by forcing each attempt to cover everything; without it both
  attempts tend to stop early in the same places, and that is why `--no-checklist`
  is unreliable. It reduces the risk of a shared blind spot; it does not remove it.
- **The gate is as good as your tests.** Without `--gate`, agreement is the only
  check. With a thin test suite, a wrong change that both attempts agree on passes.
- **It fits work that divides into files.** A task that is one design decision in
  one file gives the comparison little to hold on to: either the attempts agree or
  that one file is disputed and the strong model decides it, which is then close
  to running the strong model on the task.
- **Comparison is textual**, ignoring trailing whitespace. Two correct fixes written
  differently count as a dispute. That costs a small strong-model call, never
  correctness.
- **Disputes are cheap only when they are few.** One to three disputed files cost
  9 to 18 credits of the strong model in the measurements; eight to ten cost 45 to
  47, which is the strong model's full price. `--max-disputed` exists for that case.

## Options worth knowing

- `--tools all` lifts the default tool restriction
  (`view,rg,glob,bash,apply_patch`). The restriction roughly halves the fixed
  context every model call carries, but a task that needs an MCP server, `task`,
  `skill`, `sql` or `web_fetch` cannot work under it.
- The repository's own `AGENTS.md` and `.github/copilot-instructions.md` are
  honoured by default. `--no-custom-instructions` turns that off.
- `--cheap-model` and `--strong-model` take any model id your account can use.
- `--checklist-file` replaces the work-method prompt with your own.
- `--gate` and `--setup` are run with `sh -c` inside the clones. They are your
  commands; treat them like any script you run.
- Everything is kept under `--out` (default: a new temporary directory):
  both clones, every transcript and usage file, the gate logs, `report.json` and
  `result.patch`. An `--out` that is not empty is refused, so an earlier result is
  never overwritten.

## Tests

`node --test experiments/tests/ladder.test.mjs` runs the whole flow against a
stand-in for the Copilot CLI (`experiments/tests/fake-copilot.mjs`) and spends no
credits. Point `LADDER_COPILOT_BIN` at another executable to do the same by hand.
