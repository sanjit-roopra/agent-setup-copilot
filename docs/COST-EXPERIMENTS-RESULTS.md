# Cost experiments: measured results

Run 2026-09-20 against the work order in `docs/COST-EXPERIMENTS.md`. Copilot CLI
1.0.86, account `sanjit-roopra`, synthetic fixture project built by
`buildFixture()` in `shunt-copilot/scripts/benchmark.mjs`.

Every number below comes from the CLI's own `--usage-output-file`
(`totalNanoAiu / 1e9`), never from an estimate. One credit is $0.01. The raw
record of each run is in `handoff/raw/exp-<id>-<variant>.json` and every run also
appended a row to `experiments/LEDGER.md`. That ledger is append-only: the runner
`experiments/run-exp.mjs` refuses to start a run whose output already exists, so
failed and inconclusive experiments stay in the history next to the ones that won.

Total spend for this batch: **378.06 credits ($3.78)** against the work order's
proposed $4 ceiling. Live runs stopped at that point with budget still unspent,
as rule 3 requires.

## Step 0: cost breakdown in the report

`bucketCredits()` in `shunt-copilot/scripts/benchmark.mjs` now splits every run's
credits into uncached input, cached input, cache write and output, per model,
from the usage file's `tokenDetails` and the published prices in
`docs/MODEL-COSTS.md`. It also reports reasoning tokens, model calls and, where a
turn made exactly one model call, that call's input tokens.

Reconciliation: on the archived Luna usage file
(`handoff/raw/luna-long-session-baseline-usage.json`, 6.374 credits) the four
buckets leave a residual of 0.0001 credits, under 0.01%. Every live run in this
batch also reconciled to a residual of 0.000. A unit test pins both the fixture
reconciliation and the per-bucket arithmetic. Models absent from the price table
are reported as unpriced rather than silently counted as zero.

## Scenario and measurement

All comparisons below use the `long-session` scenario: eight questions in one
conversation, with a per-turn regex answer check and an end-of-session check.
A new `context-probe` scenario sends one prompt that needs no tool, so its single
call's input token count is an exact measure of the session's starting context.

## Results table

Scenario `long-session` throughout, three runs each except where stated.
"Correct" counts runs where every answer check passed.

| Exp | Variant | Model | Runs | Credits (each) | Median | vs its control | Correct | Note |
| --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |
| E0 | baseline | gpt-5.6-sol | 3 | 54.905 / 56.309 / 64.231 | 56.309 | — | 3/3 | matched control for E1b on Sol |
| E1b | `--available-tools` | gpt-5.6-sol | 3 | 42.182 / 44.790 / 56.383 | 44.790 | **-20%** | 3/3 | ranges overlap; input tokens -28% |
| E0 | baseline | gpt-5.6-luna | 3 | 4.843 / 5.356 / 8.120 | 5.356 | — | 3/3 | matched control for E1b on Luna |
| E1b | `--available-tools` | gpt-5.6-luna | 3 | 2.399 / 2.523 / 3.550 | **2.523** | **-53%** | 3/3 | ranges do not overlap |
| E1b | `--available-tools` (2nd batch) | gpt-5.6-luna | 3 | 2.121 / 2.410 / 2.818 | 2.410 | — | 3/3 | reproduction, separate batch |
| E1a | `--disable-mcp-server` per server | gpt-5.6-luna | 1 | 0.278 | 0.278 | — | 1/1 | starting context -669 tokens only |
| E1c | tools + MCP disabled | gpt-5.6-luna | 1 | 0.131 | 0.131 | — | 1/1 | no gain over E1b alone |
| E2 | MAI-Code-1.1-Flash | mai-code-1.1-flash | 3 | 3.046 / 3.086 / 3.400 | 3.086 | **+28%** | 3/3 | vs same-batch Luna control 2.410 |
| E2 | GPT-5.4 nano | gpt-5.4-nano | 0 | — | — | — | — | not available, see below |
| E3 | Auto, efficiency tier | auto | 1 | 3.418 | 3.418 | +42% | 1/1 | resolved to mai-code x21 + luna x9 |
| E9b | `--reasoning-effort low` | gpt-5.6-luna | 3 | 2.198 / 2.224 / 2.675 | 2.224 | -8% | **1/3** | wrong answers, not a saving |

Starting context, measured with `context-probe` (one model call, no tool use):

| Configuration | Starting context | Change |
| --- | ---: | ---: |
| default (2 user MCP servers loaded) | 11,768 tokens | — |
| `--disable-mcp-server sequential-thinking --disable-mcp-server sonarqube` | 11,099 tokens | -669 (-6%) |
| `--available-tools view rg glob bash apply_patch` | **5,189 tokens** | **-6,579 (-56%)** |
| both together | 5,197 tokens | -6,571 (-56%) |
| `--available-tools`, on mai-code-1.1-flash | 3,755 tokens | — |

## What won

**E1b, restricting the tool list, is the one variant with a demonstrated saving.**

```sh
copilot --available-tools view rg glob bash apply_patch ...
```

- On `gpt-5.6-luna` it took the eight-question session from a median of 5.356
  credits to 2.523, a 53% reduction, with every answer check passing in all three
  runs. The two distributions do not overlap: the most expensive candidate run
  (3.550) is cheaper than the cheapest baseline run (4.843). A second batch run
  later in the day reproduced it at 2.410.
- On `gpt-5.6-sol` it took the same session from a median of 56.309 to 44.790, a
  20% reduction, also 3/3 correct. Here the ranges do overlap (candidate maximum
  56.383 against baseline minimum 54.905), so treat the Sol figure as supported
  by the mechanism and the medians rather than as a separated distribution.
- The mechanism is visible in the buckets and is the same on both models. The
  tool schemas are part of the fixed context carried by every call. Cutting the
  starting context from 11,768 to 5,189 tokens cut Luna's cache-write credits
  from 4.076 to between 1.219 and 2.010, and Sol's main input tokens from about
  522,000 to about 385,000, a 28% reduction.
- The saving scales with the number of calls in a session, not with task
  difficulty. On the single-task `generate-tests` scenario the same flag produced
  no saving at all (median 0.694 against a 0.700 control, 3/3 correct both ways)
  and in fact needed more calls (6 to 7 against 4 to 5), because losing the other
  tools costs round trips that a short task cannot amortise.

## What showed no improvement

- **E1a, disabling user MCP servers.** Both configured servers together
  (`sequential-thinking`, `sonarqube`, 19 tool identifiers between them) account
  for only 669 tokens of starting context. The work order's hypothesis that MCP
  schemas dominate the fixed context is not supported here. Once
  `--available-tools` is in use the flag adds nothing, because that flag already
  excludes MCP tools.
- **E2, a model with no cache-write charge.** `MAI-Code-1.1-Flash` does bill the
  way the price table predicts: zero cache-write credits, everything in uncached
  and cached input. It was still 28% more expensive than Luna on the same
  scenario in the same batch, because it needed 27 to 31 model calls where Luna
  needed 17 to 19. Price per token did not survive contact with round-trip count.
- **E3, Auto with the efficiency tier.** One run only, so this is exploratory
  rather than settled. It resolved to 21 `mai-code-1.1-flash` calls and 9
  `gpt-5.6-luna` calls and cost 3.418 credits, more than pinning Luna directly.
  It answered correctly. Its behaviour is consistent with the E2 result: routing
  work to the model with more round trips costs more than its unit price saves.

## What cost quality

- **E9b, `--reasoning-effort low`.** Median 2.224 credits against a 2.410
  control, about 8% cheaper, but only one of three runs passed all answer checks.
  The concrete failure is the same in both failing runs: asked which SKU in
  `src/pricing-rules.mjs` has the largest discount, the model answered
  "the largest discount is 22, tied across SKU-014, SKU-037, SKU-060, SKU-083 and
  SKU-106". The correct answer is SKU-077 at 40. The fixture writes every discount
  as `(i * 7) % 23` except that one deliberate outlier, so the low-effort model
  reasoned about the formula instead of scanning the values. Under rule 6 this is
  a failed run, not a saving.

## What could not be tested

- `gpt-5.4-nano`, proposed in E2 as the second no-cache-write candidate:
  `Error: Model "gpt-5.4-nano" from --model flag is not available.`
- E13 `cheap-first`, the bounded-escalation arm, is implemented in
  `benchmark.mjs` and unit tested, but it was never exercised end to end. Luna
  passed the acceptance checks on `generate-tests` in 3 of 3 runs and on
  `long-session` in 3 of 3 runs, so the escalation to Sol never fired. On this
  fixture the arm is identical to plain Luna. Measuring it needs tasks the cheap
  model actually fails, which this synthetic project does not contain.
- E4 idle gaps, E5 consultant, E6 plan-then-execute, E7 output filtering, E8
  context map, E10 no-tools ask, E11 instruction files, E12 deterministic
  processing, E14 Jev routing and E15 native escalation: not started. The budget
  was spent on establishing one variant properly rather than sampling many.
  `--turn-gap-sec` (E4) and `--custom-instructions` (E11) are implemented and
  ready; neither was run.

## Combining the winners

The two effects that survived are independent and multiply, because one changes
the price per token and the other changes how many tokens each call carries:

| Configuration | Median credits | Against pinned Sol |
| --- | ---: | ---: |
| `gpt-5.6-sol`, default tools | 56.309 | — |
| `gpt-5.6-sol`, restricted tools | 44.790 | -20% |
| `gpt-5.6-luna`, default tools | 5.356 | -90% |
| `gpt-5.6-luna`, restricted tools | **2.523** | **-96%** |

All four configurations passed 3 of 3 answer checks on this scenario. That is a
regex check on facts, not a judgement of reasoning quality, and the fixture is a
four-file synthetic project. Before adopting the bottom row for real work,
confirm the model choice on your own repository with
`--project` and `--prompts`; the tool restriction is far less risky, since it
changes what the model may call rather than how well it reasons.

## Caveats

- Three runs are a screening sample, not statistical significance. Run-to-run
  spread was large: Luna's baseline ranged 4.843 to 8.120, a factor of 1.7 on
  identical input, driven by how much of the context was served from cache.
- Baseline and candidate were run as separate benchmark invocations, so their
  cache states are not counterbalanced within a batch. The E1b Luna result was
  reproduced in a second batch hours later, which partly addresses this; the Sol
  result was not.
- The fixture is synthetic and small. The `--available-tools` set used here
  (`view rg glob bash apply_patch`) was enough for these scenarios including file
  edits, but a session that needs `task`, `skill`, `sql`, `web_fetch` or an MCP
  server will fail outright rather than degrade, so the set has to be chosen per
  workload.
- `handoff/raw/exp-E2-probe-nano.json` records a run with zero model calls and
  zero credits. That is the unavailable-model error, not a free session.

## Follow-up: does the cheap model hold up on harder tasks?

The objection to the table above is fair: the `long-session` and `generate-tests`
scenarios are questions and a small test-writing task over a four-file synthetic
project, checked by regular expressions. Luna passing them says little about a
task that needs real reasoning, and `--reasoning-effort low` had already shown
that cheap reasoning fails in exactly that way.

Two harder scenarios were built in `experiments/hard-fixture.mjs` to test it.
Both share a shape designed to defeat a superficial fix:

- The visible symptom is in a different file from the root cause.
- Exactly one visible test fails, and it names one specific input.
- A **held-out** test suite, which the session never sees, is copied in after the
  session ends. Both suites must pass for the run to count as accepted.

`hard-debug`: `tests/billing.test.mjs` fails on "a whole leap February costs
exactly the monthly rate". `src/billing.mjs` is correct; `src/calendar.mjs`
returns month lengths from a constant `MONTH_LENGTHS` table that has no leap-year
handling. The held-out suite checks February for 2024, 2026, 2028, 2000, 1900 and
2100. 1900 is the trap: divisible by 100 but not 400, so not a leap year.

`hard-refactor`: rename every pipeline stage to a `stage:` prefixed name. Two of
the call sites build the name at run time (`STAGES.reduce(...)` and
`dispatch(STAGES[index], ...)`), so a rename that only edits the literal strings
it can grep for leaves the registry and the stage list disagreeing. The held-out
suite asserts that they still agree and that every index still resolves.

The grader was validated against three planted fixes before any live run:

| Planted fix | Verdict |
| --- | --- |
| special-case `from.y === 2024` in `billing.mjs` | rejected at the held-out stage |
| `m === 2 && y % 4 === 0` in `calendar.mjs` | rejected at the held-out stage |
| full leap rule `y % 4 === 0 && (y % 100 !== 0 \|\| y % 400 === 0)` | accepted |

Result, `gpt-5.6-luna` with the restricted tool list, three runs each:

| Scenario | Runs (credits) | Accepted | Grade stage | Calls |
| --- | --- | ---: | --- | --- |
| hard-debug | 0.382 / 0.425 / 0.463 | **3/3** | passed | 5 / 5 / 6 |
| hard-refactor | 0.422 / 0.469 / 0.543 | **3/3** | passed | 5 / 6 / 6 |

In all three `hard-debug` runs Luna edited `calendar.mjs`, not `billing.mjs`, and
wrote the identical complete rule:

```js
if (m === 2 && (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) return 29;
```

That is the root cause in the right file with the century rule included, three
times out of three, at about 0.4 credits per task. It is not luck and it is not a
fix that the held-out suite would have caught.

### What this does and does not settle

It settles that the cheap model is not obviously disqualified from
cross-file root-cause debugging or from a refactor with run-time references, on
tasks of this size, under a grader that rejects superficial fixes.

It does not settle the general question. These are still three-file fixtures with
one defect each and a stated symptom. Untested: large real repositories, work
spanning many files, ambiguous or self-contradictory requirements, tasks with no
failing test to anchor on, and anything where the expensive model's advantage is
judgement rather than correctness.

### Consequence for E13

E13 `cheap-first` still could not be measured. Luna has now passed the acceptance
checks in 12 of 12 runs across four scenarios, so the escalation to Sol has never
fired and the arm remains behaviourally identical to plain Luna. Measuring the
escalation economics needs tasks the cheap model actually loses, and this batch
failed to construct one. That is a finding about the fixtures, not evidence that
escalation is unnecessary.

The next step, if this is funded further, is to run the same graded comparison on
a real repository with `--project` and `--prompts`, where task size and ambiguity
are not under the experimenter's control.

## Follow-up 2: a benchmark the cheap model loses

Luna also scored 7 of 7 in all three runs of `spec-audit` (one carrier, seven
planted specification violations behind a green test suite, 1.65 to 2.22
credits), so a small audit with nothing to anchor on is still not hard enough.

Published tier comparisons say where to look. On short agentic coding the gap is
small (Terminal-Bench 2.1: Sol 88.8, Luna 84.7), which matches the 18 of 18 above.
The gap opens with scale and with many near-identical items that have to be kept
apart (MRCR v2 at 256K and above: Sol 91.5, Luna 41.3; OSWorld 2.0: 62.6 against
45.6). Sources: <https://layerlens.ai/blog/gpt-5-6-benchmark-review-sol-terra-luna>,
<https://www.vellum.ai/blog/gpt-5-6-sol-terra-luna-explained>. Those figures were
read through a summarising fetch tool and should be re-read before being quoted.

`spec-audit-xl` (`experiments/spec-audit-xl/generate.mjs`) turns that into a coding
task. It generates 24 carriers, each with its own `SPEC.md`, `engine.mjs` and a
passing test, 128 KB in total. The engines are near-identical, but each of ten
rules has two legitimate variants (half-even or half-up rounding, inclusive or
exclusive threshold, volume discount first or coupon first, and so on) and every
carrier's specification picks its own. What another carrier does is therefore
never evidence of what this one should do, and a script that diffs engines against
a template finds nothing. Fourteen of the 240 carrier-rule pairs are planted
violations, at most two per carrier, with some carriers left clean.

Grading is differential. For every pair the grader generates an oracle engine from
the specification parameters and compares behaviour on probe inputs that were
selected so that flipping that one rule changes the output and flipping any other
rule does not. A planted pair that now matches the oracle counts as fixed; an
unplanted pair that no longer matches counts as a regression. `validate.mjs`
proves, before any credit is spent, that every pair has at least two isolating
probes, the broken project scores 0 with no regressions and a green visible suite,
and the oracle engines score 14 of 14.

Result, `gpt-5.6-luna` with the restricted tool list:

| Run | Credits | Fixed | Regressions | Calls | Accepted |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 3.68 | 6/14 | 2 | 10 | no |
| 2 | 5.18 | 13/14 | 0 | 20 | no |
| 3 | 9.66 | 9/14 | 1 | 30 | no |

Zero of three runs were accepted; the median is 9 of 14. Three things stand out.
The first run ended after ten calls with the statement "Audited all 24 carriers
and fixed every SPEC.md deviation in five engines", which was false on both
counts. Two of the three runs damaged a carrier that was correct: in run 1 Luna
rewrote `elm`'s discount order to coupon-first and its minimum charge to the base
fee, while `elm`'s own specification says volume-first and whole-line floor. Those
are other carriers' rules applied to the wrong carrier, which is the
keep-similar-things-apart failure the published long-context numbers describe.
And `nettle:threshold`, a numeric mismatch between specification and constant, was
missed in all three runs.

This is not yet a comparison. Sol has not been run on this task, so it shows that
Luna fails here, not that Sol succeeds. It does make E13 measurable for the first
time: the cheap attempt now fails its acceptance check, so the escalation fires.

Spend: these three runs cost more than estimated (18.5 credits against about 11),
which took the batch total to **404.82 credits ($4.05)**, 4.82 credits over the
work order's proposed ceiling.

## Follow-up 3: Sol quality for less, on the benchmark that separates the tiers

With the budget ceiling lifted by the owner, `spec-audit-xl` was run on Sol and on
four candidate configurations, three runs each, all with the restricted tool list.
"Accepted" means all 14 planted violations fixed, no regression in the other 226
carrier-rule pairs, and no specification or test edited.

| Configuration | Accepted | Credits per run | Median | Against Sol |
| --- | --- | --- | ---: | ---: |
| `gpt-5.6-sol` | 3/3 | 49.66 / 58.74 / 64.10 | 58.74 | — |
| `gpt-5.6-luna` + `experiments/prompts/checklist.md` | **3/3** | 15.19 / 18.98 / 23.15 | **18.98** | **-68%** |
| `gpt-5.6-terra` | 2/3 | 21.52 / 24.47 / 48.26 | 24.47 | -58% |
| `cheap-first` (Luna, then Sol when the grader rejects) | 3/3 | 8.22 / 48.94 / 61.04 | 48.94 | -17% |
| `review-loop` (Luna, Sol reviews the diff, Luna repairs) | 2/3 | 41.24 / 54.21 / 54.54 | 54.21 | -8% |
| `gpt-5.6-luna`, no scaffold | 0/3 | 3.68 / 5.18 / 9.66 | 5.18 | not a saving |

The benchmark does separate the tiers: Sol was accepted in every run with 9 to 12
model calls, and unscaffolded Luna in none.

**The work-method prompt is what won.** `checklist.md` is seven lines. It tells the
model to enumerate every unit and every rule into a checklist before touching
anything, to fill each cell from that unit's own sources and never from a
neighbour, to script the mechanical checks, to re-verify every cell after editing,
and not to report completion until every cell has been checked. With it Luna went
from 0 of 3 to 3 of 3, fixing 14 of 14 with no regression every time. The cost is
visible in the call count: 58 to 66 model calls against 10 to 30 without it. Luna's
failure on this task was stopping early and confusing neighbours, not an inability
to do the work, and the scaffold buys the missing thoroughness at Luna's prices.

**Every arm that lets Sol read the repository costs about what Sol costs.** In
`review-loop` the Sol review alone cost 34 to 46 credits of each run's 41 to 54,
although the reviewer was told to look at the diff: to judge a diff against 24
specifications it has to read them. In `cheap-first` the two escalated runs cost
44 and 57 credits for the Sol part. On an expensive model the bill is dominated by
what it reads, so an architecture saves money only if the strong model reads less,
and on an audit task it cannot. This is the same arithmetic that sank the fleet.
`review-loop` also lost one run to a regression introduced during repair.
`cheap-first` additionally depends on the held-out grader to decide when to
escalate, which real work does not have; its figure is an upper bound.

Terra is cheaper than Sol and was right twice, but its third run fixed 7 of 14 and
broke a clean carrier, the same failure as unscaffolded Luna. At three runs that is
not distinguishable from an unlucky draw, and it is not a recommendation either.

### Limits

Three runs per arm on one generated task. The scaffold was written after seeing
how Luna failed on this task, so it has not been shown to transfer; the honest next
test is the same seven lines on a different task family and on a real repository
through `--project` and `--prompts`. Sol and Terra were not run with the scaffold,
so whether it would make them cheaper or more reliable is unknown.

Total spend across the whole work order: **997.07 credits ($9.97)**, of which
592.26 after the owner lifted the $4 ceiling.

## Follow-up 4: escalating without an answer key (the `ladder` arm)

`cheap-first` decides to escalate by asking the held-out grader, which real work
does not have. The `ladder` arm replaces that trigger with signals that exist in
the wild. Two independent cheap attempts run concurrently in separate copies of
the repository and separate sessions. The repository's own tests are the gate.
The two results are compared file by file, ignoring trailing whitespace. If they
agree and the gate passes, the work is accepted with no strong-model call. If not,
the strong model is given only the disputed files, with the second attempt's
versions alongside, and told not to touch or read beyond them. The held-out grader
scores the outcome afterwards and never influences the decision.

Signals that were checked first and do **not** work as a trigger: model call
count, tool call count and how many of the 24 specifications were read. Failed and
accepted runs overlap completely on all three (a failed Luna run and every Sol run
read 24 of 24 specifications in 9 to 12 calls), and the model's own completion
claim was false in the worst run.

Results on `spec-audit-xl`, restricted tool list, Luna as the cheap model and Sol
as the arbiter:

| Configuration | Accepted | Credits per run | Median | Against Sol (58.74) |
| --- | --- | --- | ---: | ---: |
| ladder, Luna + `checklist.md` | **3/3** | 25.76 / 38.61 / 48.81 | 38.61 | -34% |
| ladder, plain Luna | 3/5 | 15.75 / 26.42 / 27.53 / 54.93 / 57.99 | 27.53 | not a saving |

Per run, with the second attempt graded on its own afterwards:

| Arm | Run | Attempt B alone | Disputed files | Sol arbitration | Final |
| --- | --- | --- | ---: | ---: | --- |
| plain | 1 | 6/14, 1 regression | 3 | 17.95 | 8/14, rejected |
| plain | 2 | 14/14 | 0 | none | accepted |
| plain | 3 | 3/14 | 10 | 47.40 | accepted |
| plain | 4 | 14/14 | 3 | 14.68 | accepted |
| plain | 5 | 4/14, 4 regressions | 8 | 44.62 | 10/14, rejected |
| checklist | 1 | 14/14 | 3 | 18.39 | accepted |
| checklist | 2 | 14/14 | 0 | none | accepted |
| checklist | 3 | 13/14 (missed `nettle`) | 1 | 9.49 | accepted |

What this shows:

- **Disagreement catches independent mistakes and nothing else.** Both rejected
  plain runs were wrong in the same way on the same carriers: in run 1 both
  attempts skipped `kelp`, `oak`, `rowan`, `tansy` and `ulmus`, so those files were
  never in dispute and the strong model never saw them. Two unscaffolded attempts
  share the habit of stopping early, so their omissions are correlated, and a
  correlated omission looks like agreement. No wrong work was accepted *silently
  with zero disputes*, but escalation did not repair what neither attempt touched.
- **The scaffold is what makes the errors independent.** With the checklist each
  attempt covers every carrier, so what remains is the occasional isolated slip,
  which is exactly what comparison detects. Checklist run 3 is the case in point:
  attempt B missed `nettle:threshold`, the comparison flagged that one file, and
  Sol repaired it for 9.49 credits. That also corrects an impression left by
  follow-up 3: Luna with the checklist is not perfectly reliable on its own. Across
  the single-attempt runs and the separately graded second attempts it was right
  in 5 of 6.
- **Scoped arbitration is cheap when the dispute is small.** One to three disputed
  files cost 9 to 18 credits of Sol, against 34 to 46 for the unscoped review in
  `review-loop` and about 59 for Sol doing the task. With 8 to 10 disputed files
  it cost 45 to 47, which is Sol's full price again; at that point the cheap
  attempts have failed and the ladder has saved nothing.
- **Textual comparison raises some false alarms.** Checklist run 1 disputed three
  files although attempt B was fully correct, so at least part of that dispute was
  two correct fixes written differently. That costs credits, not correctness. A
  behavioural comparison (run each attempt's tests against the other's code) would
  reduce it and has not been built.

Where this leaves the recommendation: a single Luna attempt with the checklist is
the cheapest configuration that was usually right (median 18.98 credits, 5 of 6).
The ladder on top of it roughly doubles the cost (median 38.61) and was right in
3 of 3, still a third below Sol. It is insurance, priced accordingly, and worth it
where a silent miss is expensive. The ladder without the scaffold is not worth
running.

Limits: one task family, three to five runs per arm, and a task that divides
cleanly into files. A change that is one architectural decision gives comparison
nothing to hold on to. Total spend to date: **1292.87 credits ($12.93)**.
