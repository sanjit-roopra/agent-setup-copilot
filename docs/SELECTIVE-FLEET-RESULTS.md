# Sol with selective delegation: implementation and measurements

Measured 2026-09-20 with Copilot CLI 1.0.86. Sol remains the primary model.
The coordinator now has read, search, edit, execute and agent tools. Its scoped
guard allows direct work under normal host permissions, while still validating
specialist names, model overrides and delegation size. Expensive reviewer guards
and all specialist model pins remain unchanged.

Routing instructions call for direct execution of small lookups, focused edits
and short checks; substantial bounded work can go to specialists. They encourage
reuse of prior findings and discourage duplicate investigation. Independent review
is conditional on user/repository requirements or remaining material risk, rather
than compulsory after every edit. Explore now has guidance to search declarations
and sample relevant implementations instead of paging through every large file.
These routing choices are advisory, not a deterministic cost optimizer.

## Results

All costs below include workers. Both arms used fresh throwaway projects, the
same prompts and a Sol primary. The small implementation scenario and eight-turn
conversation each ran three times per arm, alternating baseline then fleet.
The broader implementation comparison ran once per arm. The two repeated batches
ran concurrently in separate projects; elapsed times should not be treated as an
isolated latency experiment.

| Workload | Plain Sol credits | Revised fleet credits | Difference |
| --- | ---: | ---: | ---: |
| Small test generation, median of 3 | 8.158 | 9.066 | +11.1% |
| Eight-question session, median of all 3 | 56.395 | 51.185 | -9.2%, but one fleet run incomplete |
| Eight-question session, only the 2 complete pairs, median | 55.805 | 52.259 | -6.4% |
| Broader test generation, 1 pair | 50.705 | 37.503 | -26.0% |

**Every run used Sol directly, with zero subagent calls.** The CLI exposed the
`task` delegation tool, but the model chose not to use it. These measurements show
the behavior of the revised profile, not a demonstrated saving from delegating to
cheap models. The modest repeated difference and the larger single-sample result
are not enough to establish a reliable overall saving. The small task cost more.

The broader prompt requested tests for all 108 event handlers, invalid IDs,
initial and repeated events, delivery retry success and exhaustion using an
injected sleep stub, and OrderService success, inactive-user and unknown-order
paths. Inspection confirmed the requested areas, with production source unchanged.
Baseline generated 244 passing tests; fleet generated 135 passing tests. The fleet
combined several assertions per handler into one test, so counts are not quality
scores. This was a synthetic fixture, not a production repository.

## Quality checks and a benchmark fix

All six small implementation suites passed. An independent seven-defect mutation
audit also passed for all six: duplicate acceptance, inactive creation, missing
storage, missing-lookup acceptance, ignored deactivation, always-inactive status,
and unknown-user activation were all detected.

The original long-session check searched across concatenated answers. Fleet run 1
only acknowledged the first question, but later answers contained enough matching
words for the old checker to pass. The benchmark now checks each answer separately
and requires all turns. A regression test covers this false-positive case.

The live batch had already started when this bug was discovered, so its saved
transcripts were rescored with the new checks. Baseline passed 3/3 conversations;
fleet passed 2/3. The audited raw data retains `originalCorrect` and each turn's
check result. The incomplete run cost 35.602 credits; it must not be counted as
successful cheap work. No repair cost is included because that run was not repaired.
The per-turn checks remain factual regex checks, not exhaustive reasoning grading.

## Evidence and reproduction

Raw summaries are in `handoff/raw/selective-fleet-*.json`; the broader prompt is
`handoff/raw/selective-fleet-bulk-prompt.txt`. Full local transcripts and generated
projects are in `/tmp/copilot-selective-long-20260920`,
`/tmp/copilot-selective-edits-20260920` and `/tmp/copilot-selective-bulk-20260920`.
Temporary directories are not durable archives.

From the repository root (these consume real credits):

```sh
node shunt-copilot/scripts/benchmark.mjs --model gpt-5.6-sol \
  --arm baseline,fleet --scenario generate-tests --runs 3
node shunt-copilot/scripts/benchmark.mjs --model gpt-5.6-sol \
  --arm baseline,fleet --scenario long-session --runs 3
```

The fleet now supports the intended direct-work-plus-delegation architecture.
Actual delegation savings still require a workload on which Sol chooses a worker
and the total successful-task cost, including retries and review, beats plain Sol.
Do not interpret these results as evidence that selective cheap delegation cannot
work, or as proof that the new profile already delivers that saving.
