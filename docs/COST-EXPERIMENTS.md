# Cost experiments: work order

This is a proposed work order, not a record of completed experiments. It extends
the catalog introduced in `5b04fc4`, preserving E0–E11 and adding E12–E15.
Updated 2026-09-20 after reviewing the code, saved measurements, Copilot CLI
1.0.86 help, and the primary sources below. This update implements no experiment
and starts no paid runs. Use the priority order below when execution is requested.

## Background you need

Copilot bills tokens as AI credits (1 credit = $0.01) at each model's published
price. Earlier attempts did not establish a reliable overall saving from
delegation. Local notes are in `handoff/HANDOFF.md`; some evidence files and the
Economy/selective-fleet changes were uncommitted when this document was updated.
Do not assume a fresh checkout contains them. Record the tested code revision and
archive the relevant evidence before attempting reproduction. The short version:

- A plain eight-question session on `gpt-5.6-sol` cost 44.84 credits. Split by
  price bucket: 51% uncached input, 33% cached input, 16% output.
- In that historical comparison, the fleet reduced Sol's cost to 34.04 credits
  but added 15.68 credits of helper work: 49.72 total. Helpers incurred cache
  writes, cache reads and output charges; the effect was not limited to one bucket.
- Revised selective-fleet samples used no subagents. Some cost less, one session
  was incomplete, and small implementation tasks cost more. These are profile
  measurements, not proof of either successful or ineffective delegation.
- Every model call carries 12,000 to 14,000 tokens of fixed context (system
  prompt, tool schemas) before any file is read in the observed configuration.
  Its removable portion and cost share have not been isolated experimentally.
- The same session on `gpt-5.6-luna` cost 6.37 credits, and 77% of that was
  cache-write charges.

Prices per million tokens are in `docs/MODEL-COSTS.md`.

Two further observations motivate new experiments:

- Fleet helpers generated 62,360 output tokens, including 37,362 reasoning
  tokens. Output cost 7.48 of their 15.68 credits. The profiles do not explicitly
  set reasoning effort; lower effort is a separate variable from cheaper models.
- Two plain-Sol test-generation runs each made four calls and processed about
  56,000 input tokens, but cost 7.98 and 11.37 credits. Cache-read shares were
  approximately 81% and 65%. A price difference alone does not identify its cause.

These observations come from local `handoff/raw/sol-long-session-fleet-usage.json`
and `handoff/raw/economy-implementation-3-runs.json`; they are historical context,
not new E0 results. Economy's small synthetic implementation comparison showed
93.8% lower median cost, but one of three suites missed a mutation caught by Sol.
Cheap execution is promising; equal quality is not established.

## Rules

1. Do not change `.github/agents/`, `.github/fleet/`, `shunt-copilot/hooks/`,
   `shunt-copilot/skills/` or `scripts/install.mjs`. Experiments go in
   `shunt-copilot/scripts/benchmark.mjs` (new arms or options), in new files
   under `experiments/`, and in this document's results table.
2. One experiment at a time. Change one thing per experiment against the
   baseline. If you change two things you cannot tell which one worked.
3. Retain the original work order's **400-credit ($4) proposed pilot ceiling**;
   documenting it does not initiate or authorize a new run. It cannot fund this
   entire catalog. Before execution, select a subset, estimate its cost, reserve
   room for failed runs, and stop dispatching before the remaining budget is
   exhausted. CLI session limits are soft limits. Jev/API charges are separate:
   track their USD cost and include them within the combined $4 pilot ceiling.
4. Always run `node shunt-copilot/scripts/benchmark.mjs --dry-run ...` first
   and read the plan before a live run.
5. Use at least three paired runs for screening when the budget permits; three
   runs do not establish statistical significance. Counterbalance baseline and
   candidate order. Report individual results, medians, spread and cache buckets.
   A 15% reduction is a practical screening target, not a boundary between signal
   and noise. Mark small or unstable samples inconclusive.
6. A run whose answer check fails does not count as a saving. Record it as
   failed, with its cost.
7. Cost means `totalNanoAiu / 1e9` from the CLI's usage file, all agents and
   workers included. Never estimate from file sizes or character counts.
   Count each session's final cumulative usage once, not the sum of resumed-turn
   totals. Include router, consultant, review and repair costs without counting
   in-session subagents twice. Missing usage is unknown, never zero.
8. After any change to `benchmark.mjs`, run
   `node --test shunt-copilot/tests/*.test.mjs tests/*.test.mjs`. Add a unit
   test for new parsing or arithmetic. Do not run a live benchmark with failing
   tests.
9. If something cannot be done (a flag does not exist, a model is not enabled
   on this account), write down the exact error text under that experiment and
   go to the next one. Do not invent a workaround that changes what is tested.
10. Check CLI flags with `copilot --help` before using them. Record CLI version,
    resolved models, effort, context tier, active tools/MCPs/plugins/instructions,
    session timing, cache behavior and relevant settings. Flags below were checked
    against 1.0.86 where stated; documentation is not a live integration test.
11. Judge cost per accepted task: total cost of all attempts divided by accepted
    tasks. Report acceptance rate alongside it; zero accepted tasks has no finite
    cost per success. Freeze checks before comparing arms, including mutation or
    held-out tests where generated tests could pass without covering behavior.
    A model's self-reported confidence is not an acceptance check.
12. Screen cheaply on fixtures, then validate promising candidates on actual
    repository tasks at identical starting commits. Include log-heavy debugging,
    scoped edits, mechanical bulk work and difficult cross-file tasks. Keep model,
    effort and tool configuration fixed except for the variable under test.
    Preserve required repository instructions consistently in real-task arms.

## How the benchmark works today

`shunt-copilot/scripts/benchmark.mjs`, documented in
`shunt-copilot/BENCHMARK.md`. Committed arms at `5b04fc4`: `baseline`, `shunt`,
`fleet`. The working tree also contains an `economy` arm; verify availability
before running it. Other arms/options in this document are proposals to build.
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

Historical baselines can reject implausible ideas cheaply. A claimed improvement
requires a matched baseline in the same measurement batch: do not compare only
against an old favorable run. Separate fresh-task and resumed-session workloads;
new local session IDs do not guarantee cold provider caches.

## Step 0: cost breakdown in the report

Before any experiment, extend the benchmark report so every run shows credits
split into four buckets: uncached input, cached input, cache write, output.
Compute each from the usage file's `tokenDetails` (`input`, `cache_read`,
`cache_write`, `output`) times the price in `docs/MODEL-COSTS.md`. The four
buckets should reconcile with `totalNanoAiu / 1e9`; test a known pinned-model
fixture within 1%, such as the local Luna usage file (about 6.374 credits), if
available. Record discounts, context tiers and any unexplained residual instead
of forcing a match for Auto or unsupported pricing. Do not double-count cached
tokens inside `inputTokens`, or reasoning tokens inside output. Also report model
calls, reasoning tokens, and first/last-call input if the trace exposes them;
mark unavailable fields explicitly. First-call input includes the task prompt
and instructions, so it is a starting-context measure, not pure system overhead.

This needs no live run. Every later experiment is judged by which bucket moved.

## Experiments

Each experiment lists the idea, what to build, the command shape, and what
result would count as a win.

### E0. Baselines

Select baselines for the first candidate only. Running both models on both
scenarios three times could spend roughly 225 credits before testing any idea.
Begin with a scoped task and its matched candidate; budget long sessions
separately. Record per-run cost, acceptance, bucket split and resolved effort.

### E1. Smaller fixed context

Idea: fewer tool schemas in the prompt means fewer tokens on every call.

Build: add typed benchmark options, or an argument-array configuration passed
directly to `spawn` with `shell: false`, plus a separate result label. Do not
introduce shell-evaluated argument strings or allow overrides of accounting flags.

Test, each against the E0 Sol baseline:

- a. Disable every user-configured MCP server:
  `--disable-mcp-server <name>` once per server. List servers first with
  `copilot mcp list` or the CLI's equivalent.
- b. Restrict tools to what the scenario needs: `--available-tools` with only
  the file view, search, shell and edit tools. The flag exists in 1.0.86;
  verify actual tool identifiers and that required work remains possible.
- c. a and b together.

Measure: input tokens of the first call in a session (starting context) and
total credits. Win: starting context down by 3,000 tokens or more and median
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

Idea: GitHub documents a 10% model-cost discount for paid-plan Auto usage and
task-aware routing at session/compaction boundaries. The installed CLI supports
`--model auto --auto-tier efficiency`; `balance` is a separate comparison.
See [Auto selection](https://docs.github.com/en/copilot/concepts/models/auto-model-selection).

Test: plain CLI, separate from the required-model fleet. Record resolved models,
effort, credits and acceptance. The discount applies to the selected model's
charges, not necessarily a 10% saving against pinned Sol. Model selection is
part of this arm's behavior, so report its distribution rather than stopping
when it changes. Compare with pinned Sol and cheap-first execution on matched
tasks. A same-model comparison can separately examine the discount.

### E4. Idle gaps and cache expiry

Idea: real sessions have pauses. A cache miss can replace discounted reads with
uncached-input or cache-write charges, depending on the model. The benchmark
sends prompts back to back and does not isolate idle-gap effects.

Build: add `--turn-gap-sec <n>` that sleeps between turns of `long-session`.

Test on `gpt-5.6-luna` only (cheap): gaps of 0, 360, 2100 and 3900 seconds,
one run each. These take hours of wall time; run them in the background. For
each turn record `cache_read`, `cache_write` and uncached `input` tokens, plus
the incremental charge rather than the cumulative resumed-session total.

Report: the gap at which `cache_read` drops to near zero on the next turn.
That is an observed cache-expiry boundary, not proof of a universal cache
lifetime. Cache eviction and configuration changes can also cause misses.
Only if the remaining budget permits, repeat the adjacent gaps with Sol.

Follow-up if the cache does expire: measure whether sending `/compact` as the
last prompt before the gap makes the post-gap turn cheaper than doing nothing.

### E5. Cheap main model, expensive consultant

Idea: the reverse of the fleet. Luna runs the whole session and owns the
context. Sol is called rarely, with a small written brief, only for hard
decisions.

Build: a new agent profile in `experiments/agents/consult.agent.md` pinned to
`gpt-5.6-luna` with read, search, edit and execute tools. Its instructions:
when stuck on a design decision or after a bounded failed attempt, prepare a
compact brief containing the original goal, exact evidence and unresolved
question. Launch a tool-less Sol consultant through a helper using an explicit
argument array and stdin, with a verified empty tool list. Do not use shell
substitution or assume paths provide evidence to a consultant with no tools.
The helper's own context and startup cost count. Add a benchmark arm
`consult` that installs this profile into the throwaway project. Collect the
consultant's usage with `--usage-output-file` into the worker usage directory
so its cost is counted, the same way the Shunt worker's is.

Test: both scenarios, plus the broader test-generation prompt in
`handoff/raw/selective-fleet-bulk-prompt.txt`.

Record: how often the consultant was called, its cost, total cost, check
results. Compare against E0 Luna (is the consultant worth its cost?) and E0
Sol (how much cheaper is the whole thing?).

This is advice followed by continued Luna execution. E13 instead hands remaining
work to a strong executor; measure them separately. Brief size is a target, not
permission to omit requirements. Hard tasks may escalate before editing.

### E6. Plan in one session, execute in another

Idea: a strong model writes a plan file once. A cheap model executes it in a
fresh session. No subagents, no shared context.

Build: a benchmark arm `plan-execute` that runs two sessions per task:
first `--model gpt-5.6-sol` with the task prompt plus "Only write PLAN.md;
do not change source or tests. Include files, steps and acceptance checks in
at most 40 lines."
Then `--model gpt-5.6-luna` with "Implement PLAN.md. Run the checks." Sum both
sessions' credits.

Test: `generate-tests` and the broader test-generation prompt. Questions-only
scenarios make no sense here; skip `long-session`.

Win: total below E0 Sol by 30% or more with checks passing. Also compare with
E0 Luna: if Luna alone passes the same checks, the plan added cost for nothing
on this task. Say that plainly if so.

### E7. Direct command-output filtering

Idea: reduce noisy command output before it enters model context without adding
a model call. Fresh-input/cache-write and subsequent cache-read effects must be
measured separately. This removes Shunt's deny-and-retry pattern for this surface.

Test a: instruction-only quiet test/build output, preserving exact errors and
providing a path to the complete log. Avoid arbitrary source truncation.

Test b: a deterministic command filter using `preToolUse.modifiedArgs` or
`postToolUse.modifiedResult.textResultForLlm`. Both mechanisms are documented in
the [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference).
First prove integration on the installed CLI: filtering really occurs before
model consumption, normal permissions and exit status are preserved, and no
denial/retry turn is added. Match only intended command tools. Keep full logs
and useful diagnostics, including errors outside the final lines. Do not replace
failed results with success. No model summarizer in this arm.

Test log-heavy debug/build tasks as well as a small-edit control. Broad source,
MCP and web-result filtering is a separate lower-priority variant, not part of
the default. RTK, quiet-bash or context-mode are candidates to inspect, not
automatically install or stack. Their CLI adapters must pass the same checks.

Win: lower total accepted-task cost with unchanged checks and no compensating
increase in recovery calls. Output-byte reductions alone are not a win.

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

A follow-up variant may use syntax-aware symbol boundaries, references and
test locations, with file hashes to invalidate stale entries. Keep the map
task-scoped; do not inject the entire repository index on every turn. Count
index generation/query cost and distinguish deterministic extraction from an
LLM-written summary. E12 separately tests executing mechanical work in code.

Win: model calls down by 30% or more and median credits down by 15% or more.
If calls drop but credits do not, report that; the map itself costs tokens.

### E9. Output limits

Idea: output is the most expensive token, 5x to 8x the input price.

Test a: concise final responses while preserving requested detail and complete
implementation. Do not force all tasks into five lines or suppress needed tests.

Test b: same model and prompts with explicit low versus the recorded baseline
reasoning effort. CLI 1.0.86 exposes `--reasoning-effort`; supported levels are
model-dependent. Custom agents can set `reasoningEffort`, otherwise inheriting
the parent's setting. See the [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).
Test Sol direct execution first, then low-effort extraction helpers separately.

Win: lower total accepted-task cost, not just fewer reasoning/output tokens.
Output was 16% of the historical plain-Sol bill, but almost 48% of the fleet
helpers' bill. Even deleting all 37,362 helper reasoning tokens with other usage
fixed would save only 4.48 credits, less than that fleet run's 4.88-credit loss.
This counterfactual is an upper-bound calculation, not a measured improvement.

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
`.github/copilot-instructions.md` and `AGENTS.md`. Report the first-call input
difference and total credits. The token difference estimates instruction size,
not a fixed per-call dollar charge, because later calls may use cache reads.
Treat one run as exploratory: first-call variation can
also come from other configuration. Repeat with matched configurations before
attributing a difference to instructions. Do not remove required guidance from
normal development merely to shrink the prompt.

### E12. Deterministic processing instead of repeated agent calls

Idea: let the model write a small program to enumerate, filter, aggregate or
transform data, returning a result with supporting evidence. This avoids asking
another model to perform the same mechanical work and can remove model round
trips as well as raw input. Existing shell tools may be sufficient.

Build: a separate experimental profile/arm, same Sol model and effort as the
control, with concrete guidance and small task-specific helpers. Examples:

- Extract handler names and line ranges in one program; compare the complete
  handler set with test coverage rather than paging through a large source file.
- Query exact configuration values or aggregate structured logs locally.
- Generate repetitive tests from an explicit table, preserving exceptional
  behavior and using held-out defects to check coverage.
- Follow a deterministic sequence of lookups inside one program; return only
  the evidence needed for the next semantic decision.

Test: a bulk fixture and real mechanical tasks, plus one-off lookups as negative
controls. Compare the same accepted outcomes, not numbers of generated tests.
Independent direct tool calls can already run in parallel; batching is not
automatically a gain. Include code-generation, helper debugging, parsing errors
and recovery in the cost. Do not combine with E7 or E8 during the first comparison.

Win: fewer model round trips and lower total cost with equivalent acceptance.
Record whether the agent actually executed a program; a correct result reached
through the original read loop does not demonstrate this mechanism.

### E13. Cheap executor with bounded escalation to a strong executor

Idea: Luna completes routine tasks directly; Sol handles unresolved work. Unlike
E5, Sol can inspect code, edit and run checks. Unlike the original fleet, Sol
does not coordinate every task. The current local Economy profile does not do
this automatically: it has no delegation tool and instructs the model to stop
with a handoff.

Build: an external launcher using explicit CLI model selection and separate
top-level sessions. Start Luna with the original task, relevant repository
instructions and frozen acceptance criteria. Allow an early escalation for an
unresolved design decision, or one bounded attempt followed by independent
checks. Define attempt/credit/time limits before the batch. Checks must detect
incomplete work; Luna's statement that it is done is not enough.

If escalation is needed, preserve the working diff and give Sol the original
request, relevant paths, findings, attempted changes and exact check failures.
Run the strong session sequentially on that task's isolated working copy. It
owns the remaining implementation and verification; do not bounce repeatedly
between models. Specify handling for unrelated environment failures separately
from capability failures. Do not silently change acceptance criteria.

Controls: plain Luna, plain Sol, and the consultant-only E5 arm if budget allows.
Use easy and difficult tasks; report acceptance, escalation fraction, wasted
cheap-attempt cost, strong repair cost, latency and final total per accepted task.

Economics: for a simplified same-task comparison, expected cost is
`cheap attempt + escalation fraction * strong completion + other overhead`.
Strong completion after a failed edit may cost more than starting with Sol, so
measure that term rather than substituting the plain-Sol baseline. Require
quality comparable to Sol and a cost advantage over simpler viable controls.

### E14. Jev routes before Copilot starts

Idea: use a decision model to choose the executor before paying for a Copilot
agent session. The launcher, rather than a parent model, enforces the choice.
This avoids relying on a fleet tool being selected voluntarily.

Jev returns typed decisions/probabilities; it does not implement code. It is an
external API, not a Copilot model selectable with `--model jev`. As of 2026-09-20,
[TypeSafe lists](https://docs.typesafe.ai/models) `jev-1.13.0` at $0.042 per
million input tokens with free output. A 2,000-input-token decision would cost
$0.000084, an arithmetic example rather than a measured bill. Log actual usage,
API retries and resolved version; account for this outside Copilot credits.
Access and credentials must already be available before the live arm can run.

Build: a launcher that sends the task, a small repository-context summary,
allowed executor capabilities and acceptance criteria to Jev. Ask for a choice
between Luna and Sol plus uncertainty. Code validates the choice against the
allowlist and starts `copilot --model <selected-model>`. Pin the Jev version and
record routing inputs, probabilities, policy thresholds and actual executor.
Do not send the whole conversation or repository just to decide a tier.

```text
Task + bounded context -> Jev -> launcher
                                |-- routine -> Copilot Luna -> acceptance checks
                                |                                |-- fail -> Sol
                                |-- difficult/uncertain -> Copilot Sol
```

Routing stages:

1. Cheap screening: route archived task descriptions without executing them.
   This measures latency, routing cost and decisions only, not coding success.
2. End-to-end test: execute selected models on held-out repository tasks. Use
   the exact E13 escalation and acceptance policy so only initial selection
   changes. Route once per task/major phase, not every tool call or chat turn.
3. Controls: plain Sol, E13 Luna-first, a simple deterministic routing rule, and
   native Auto Efficiency (E3). A separate cheap-LLM router is optional. Jev must
   earn its complexity over these controls, not merely beat always-expensive.

Predefine low-confidence and API-error behavior: choose Sol or stop according to
the experiment policy, record why, and include the cost. No retry loop. Model
confidence needs calibration on this task distribution; valid typed output is
not proof of correct routing. Tune thresholds on a development set, freeze them,
then score held-out tasks. Do not tune against the reported test results.

Win: lower combined USD cost per accepted task at comparable acceptance and
review quality. Report routing errors revealed by execution, escalation rate,
Jev fees, Copilot credits, repair cost and latency. The published
[jev-model-router](https://github.com/its-panzer/jev-model-router) reports 97/100
choices in an author-labelled acceptable band and 26.3% modeled savings against
always-Opus. It does not execute downstream tasks; assumes 8K input/1.2K output
and no cache reads; and is Claude-only. This is feasibility evidence, not a
Copilot cost/quality benchmark. Do not import its thresholds as established facts.

### E15. Native cheap-parent / expensive-subagent feasibility

Idea: test whether E13 can stay inside Copilot through a cheap root agent and
an explicitly pinned strong specialist, rather than an external launcher.

Build only inside the experimental project: a Luna primary with delegation
available, and one Sol executor with required model policy and explicit effort.
The installed fleet's dispatch allowlist may reject a new specialist; isolate
the experiment configuration instead of changing production guard policy.
Do not combine with Auto: current CLI docs say Auto subagents inherit the
resolved session model. Required pins should reject an unavailable authored
model, not silently substitute it. See the [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).

First run one minimal forced dispatch, before a cost comparison. Verify the
actual child model in usage/trace metadata, not its prose answer or profile name.
Record refusal, silent downgrade or missing telemetry as an unproven mechanism.
[Issue #3565](https://github.com/github/copilot-cli/issues/3565) reports higher-tier
children being downgraded in CLI 1.0.55; that historical report does not establish
current behavior on 1.0.86. Do not claim upward delegation works here until tested.

Only after the mechanism passes, compare native E15 with external E13 using
the same handoff, limits and checks. Record parent brief/finalization cost and
whether the cheap parent unnecessarily re-investigates the strong result.
Forced dispatch proves plumbing only; discretionary runs must separately show
that escalation triggers when required. If unsupported, retain E13 as a distinct
architecture, not as a claimed successful native result.

## External evidence and its limits

Sources reviewed 2026-09-20. These figures motivate experiments; none is a
measured saving for this repository's proposed arms.

| Source | Observed result | What it supports / does not establish |
| --- | --- | --- |
| [quiet-bash results](https://github.com/yoeld-wix/quiet-bash/blob/main/bench/RESULTS.md) | Claude Code/Haiku, 20 runs per arm: command-only $0.0461 vs $0.0515; full read/MCP filtering $0.0547 | Narrow E7 first; approximately 10.6% cheaper versus 6.1% more expensive, with high variance. Not a Copilot benchmark. |
| [Code Mode experiment](https://github.com/tmustier/code-mode-mcp/blob/main/docs/benchmarks/2026-07-direct-tools-and-code-mode.md) | 160 synthetic runs, all answers correct; eight-step chain median $0.0147 vs $0.0363, data reduction $0.0173 vs $0.1316 | E12 can remove model cycles. One Opus model, synthetic tools and differing cache state; short direct lookups often won. |
| [RefactorPlatform](https://arxiv.org/html/2609.04898v1) | 100 refactoring tasks: structural retrieval 86% success, delegation configuration 66%; 19 tasks never delegated | E8 structural retrieval and explicit mechanism checks. Single-run campaigns; retrieval left cost per success approximately unchanged, not lower. |
| [Token Reduction Is Not Cost Reduction](https://arxiv.org/html/2607.12161v1) | 2,848 Claude Code runs: RTK pooled cost -2.7%; experimental RTK-ML +6.8%; tested Headroom +48.4% | Do not equate compression with savings. RTK's held-out interval included no saving; results are configuration/workload-specific. |
| [LogDx-CI](https://arxiv.org/html/2605.28876v1) | 35 CI failures: hybrid grep/tail about 4.5x fewer tokens than grep at similar diagnosis scores | Preserve useful failure evidence in E7. Weak contexts forced extra agent calls; neither generic truncation nor a Copilot bill reduction is proven. |
| [Context Mode benchmark](https://github.com/mksglu/context-mode/blob/main/BENCHMARK.md) | Large reductions in delivered context for selected operations | A candidate architecture for E12/local indexing. Payload reduction is not an end-to-end paid-cost or coding-quality result. |
| [Jev router](https://github.com/its-panzer/jev-model-router) | 97/100 labelled route matches; 26.3% modeled saving against Opus | E14 feasibility only; downstream execution, repair and cache economics remain unmeasured. |

Official references for execution: [pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing),
[usage optimization](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage),
[hooks](https://docs.github.com/en/copilot/reference/hooks-reference),
[CLI/custom agents](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference),
[Auto tiers](https://docs.github.com/en/copilot/concepts/models/auto-model-selection),
and [Jev models/pricing](https://docs.typesafe.ai/models).

## Suggested execution order

This is a catalog, not a commitment to run every arm within $4.

1. Step 0 offline accounting and evidence audit; choose a representative task.
2. E0 matched baseline plus E9 effort and E7 command filtering, independently,
   for preserving the strong main model. Use E1 if removable tool overhead is high.
3. E12 mechanical processing or E8 structural map on an appropriate workload.
4. E13 bounded escalation, then E14 routing against that same policy and E3 Auto.
   Run E15's minimal feasibility check if native escalation is desired.
5. E2/E5/E6/E10/E11 as task-specific alternatives; E4 only for a workload where
   idle gaps materially affect cost. Allocate a new batch only within its budget.
6. Combine successful variants only after their separate effects are understood.

For now, defer blanket fan-out, more prompts forcing Sol to delegate, generic
compression stacks and mid-task model switching. They lack a demonstrated net
benefit here. This is prioritization, not proof they always lose. Likewise,
structural retrieval can improve correctness even when it does not lower tokens.

## Results table

Fill in one row per variant. Keep failed and skipped experiments in the table.
All E0–E15 entries remain proposed in this update; historical and external
measurements above are not new results. Keep per-run details in machine-readable
records, including paired task IDs, cache conditions, dispatch/model evidence,
escalations, quality findings and failures.

| Exp | Variant | Scenario | Model | Runs | Median credits | vs baseline | Uncached | Cached | Cache write | Output | Calls | Checks passed | Notes |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| E0 | baseline | long-session | gpt-5.6-sol | | | | | | | | | | |

Running total of credits spent: 0 / 400

This counter is for this proposed work order only, not prior repository spending.
External API spend: $0. Combined work-order spend: $0 / proposed $4 ceiling.

For multi-stage arms, also fill this comparison table (all costs include failures):

| Exp / variant | Accepted / attempted | Total Copilot credits | External USD | Combined USD | USD per accepted task | Escalations | Routing/repair findings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| E13 cheap-first | pending | | | | | | |
| E14 Jev-routed | pending | | | | | | |
| E15 native escalation | pending | | | | | | |

## Final report

When the budget is spent or every experiment is done, add a section here with:

1. The variants that won, ranked by credits saved, with the exact command or
   profile that reproduces each.
2. The variants with no demonstrated improvement, distinguishing inconclusive
   samples from supported evidence of little effect.
3. The variants that cost more or broke answers.
4. Anything that could not be tested, with the exact error.
5. Which winners can be combined, and a budgeted paired comparison of the best
   two or three. A single combined run is exploratory; savings may overlap.

Write the raw per-run JSON to `handoff/raw/exp-<id>-<variant>.json`. Archive the
tested revision, configurations, acceptance checks and safe evidence alongside
it; never commit credentials, private source dumps or generated build artifacts.
