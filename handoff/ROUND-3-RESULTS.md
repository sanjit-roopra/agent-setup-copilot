## T1/T6 spec-audit-xl: reasoning effort vs earlier arms (3 runs each unless noted; "default" = high, the account setting)

| Arm | Runs | Correct | Credits/run | Mean | Reasoning tokens/run | Calls/run | Record |
| --- | ---: | ---: | --- | ---: | --- | --- | --- |
| Sol default | 3 | 3/3 | 64.10 / 58.74 / 49.66 | 57.50 | 2785 / 2768 / 3014 | 12 / 10 / 9 | `exp-H4-sol-spec-audit-xl-3.json` |
| Terra default | 3 | 2/3 | 48.26 / 21.52 / 24.47 | 31.42 | 4932 / 1654 / 1280 | 16 / 11 / 9 | `exp-H4-terra-xl-3b.json` |
| Luna default | 2 | 0/2 | 5.18 / 9.66 | 7.42 | 3561 / 9862 | 20 / 30 | `exp-H4-luna-spec-audit-xl-2.json` |
| Luna default (run 1b) | 1 | 0/1 | 3.68 | 3.68 | 5179 | 10 | `exp-H4-luna-spec-audit-xl-1b.json` |
| Luna + checklist prompt | 3 | 3/3 | 23.15 / 15.19 / 18.98 | 19.11 | 13380 / 7485 / 8645 | 66 / 58 / 60 | `exp-H4-luna-checklist-xl-3b.json` |
| Ladder (2 Luna + Sol arbiter) + checklist | 3 | 3/3 | 48.81 / 25.76 / 38.61 | 37.72 | 8325 / 5734 / 6285 | 49 / 43 / 54 | `exp-L1-ladder-checklist-xl-3.json` |
| **Luna xhigh (new)** | 3 | 1/3 | 12.00 / 8.17 / 14.79 | 11.66 | 17927 / 9649 / 15875 | 23 / 14 / 37 | `exp-T1-luna-xhigh-xl-3.json` |
| **Luna max (new)** | 3 | 1/3 | 15.05 / 9.30 / 8.34 | 10.89 | 19434 / 14939 / 16099 | 44 / 20 / 17 | `exp-T1-luna-max-xl-3.json` |
| **Sol low (new)** | 3 | 3/3 | 38.23 / 55.72 / 29.44 | 41.13 | 889 / 1266 / 846 | 10 / 15 / 14 | `exp-T7-sol-low-xl-3.json` |
| **Sol medium (new; run 3 stalled, 0 credits, counted wrong)** | 3 | 2/3 | 56.90 / 73.57 / 0.00 | 43.49 | 2109 / 2246 / 0 | 17 / 13 / 0 | `exp-T7-sol-medium-xl-3.json` |
| **Terra xhigh (new)** | 3 | 0/3 | 47.12 / 28.26 / 59.48 | 44.95 | 8875 / 2889 / 9358 | 15 / 10 / 15 | `exp-T6-terra-xhigh-xl-3.json` |
| **Terra max (new)** | 3 | 3/3 | 70.16 / 60.74 / 48.85 | 59.92 | 12862 / 12350 / 10370 | 17 / 13 / 12 | `exp-T6-terra-max-xl-3.json` |

## T1b Pong one-liner: Luna xhigh vs earlier builds (one run each)

| Arm | Credits | Gate | tty-smoke | Python lines | Source |
| --- | ---: | --- | --- | ---: | --- |
| Luna default, 1 attempt | 6.51 | true | pass (owner round 2) | 446 | pong2 |
| Sol alone | 48.75 | true | pass (round 2) | 471 | pong2 |
| **Luna xhigh, 1 attempt (new)** | 4.24 | true | pass | n/a | `~/scratch/t1-pong-xhigh-out` |
| HydraFusion build run 1 (round 2) | 1.38 | pass | | | `greenfield/pong3-hydrafusion-build/fusion-report.json` |
| HydraFusion build run 4 (round 2) | 31.44 | pass | | | `greenfield/pong5-hydrafusion-two-turn/fusion-report.json` |

## T2 cache lifetime: identical follow-up turn after a gap, same session

Turn 1 reads 400 unique lines behind a unique nonce, so only the ~5k-token system prefix can be shared with other sessions. Turn 2 is "repeat your answer, no tools".

| Model | Gap | Turn-2 input | cacheRead | cacheWrite | Turn-2 credits | Verdict | cacheExpiresAt claimed by CLI after turn 1 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| gpt-5.6-luna | 1 min | 9679 | 5361 | 4315 | 0.12 | partial (55% read) | 2026-09-22T07:11:17.053Z (sent 2026-09-22T06:40:49.778Z) |
| gpt-5.6-luna | 10 min | 9672 | 5362 | 4307 | 0.12 | partial (55% read) | 2026-09-22T07:11:17.993Z (sent 2026-09-22T06:40:49.955Z) |
| gpt-5.6-luna | 25 min | 9688 | 5366 | 4319 | 0.12 | partial (55% read) | 2026-09-22T07:11:15.434Z (sent 2026-09-22T06:40:49.983Z) |
| gpt-5.6-luna | 35 min | 9691 | 0 | 9688 | 0.25 | MISS | 2026-09-22T07:11:16.285Z (sent 2026-09-22T06:40:50.014Z) |
| gpt-5.6-luna | 45 min | 9675 | 0 | 9672 | 0.25 | MISS | 2026-09-22T07:11:16.892Z (sent 2026-09-22T06:40:50.045Z) |
| gpt-5.6-sol | 10 min | 9675 | 0 | 9672 | 4.87 | MISS | 2026-09-22T07:11:16.109Z (sent 2026-09-22T06:40:50.076Z) |
| gpt-5.6-sol | 25 min | 9688 | 5360 | 4325 | 2.41 | partial (55% read) | 2026-09-22T07:11:17.701Z (sent 2026-09-22T06:40:50.269Z) |
| gpt-5.6-sol | 35 min | 9675 | 0 | 9672 | 4.87 | MISS | 2026-09-22T07:11:16.682Z (sent 2026-09-22T06:40:50.312Z) |

## T3 Shunt total credits per task (Sol main, from `sol-3-arms.json`, round 1 data)

| Task | Baseline | Shunt | Delta | Delegated | Main calls base→shunt | Main input base→shunt |
| --- | ---: | ---: | ---: | --- | --- | --- |
| find-a-value | 5.96 | 4.11 | -31% | no | 2→2 | 24231→24389 |
| mid-size-file | 4.63 | 12.85 | +178% | yes | 2→7 | 26365→98093 |
| summarise-big-file | 17.67 | 8.10 | -54% | yes | 4→3 | 82000→39816 |
| cross-file-question | 5.86 | 5.92 | +1% | yes | 3→3 | 39639→37565 |
| generate-tests | 11.61 | 20.07 | +73% | yes | 4→9 | 56711→134861 |

## T4 mid-session model switch (hard = cross-file-question, easy = find-a-value, then mid-size-file)

| Session | Turn | Model | Requests | Input | cacheRead | cacheWrite | Output | Credits | Correct |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| fresh-luna | 1 | gpt-5.6-luna | 3 | 17906 | 11361 | 6536 | 320 | 0.22 | true |
| fresh-luna | 2 | gpt-5.6-luna | 5 | 48559 | 42613 | 5931 | 706 | 0.32 |  |
| fresh-sol | 1 | gpt-5.6-sol | 2 | 11231 | 5332 | 5893 | 278 | 3.72 | true |
| stay-sol | 1 | gpt-5.6-sol | 3 | 19799 | 12252 | 7538 | 403 | 5.07 | true |
| stay-sol | 2 | gpt-5.6-sol | 1 | 7633 | 5345 | 2285 | 26 | 1.41 | true |
| stay-sol | 3 | gpt-5.6-sol | 2 | 18027 | 15344 | 2677 | 118 | 2.19 |  |
| switch-to-luna | 1 | gpt-5.6-sol | 3 | 19935 | 11776 | 0 | 485 | 4.70 | true |
| switch-to-luna | 2 | gpt-5.6-luna | 1 | 7679 | 0 | 7676 | 199 | 0.22 | true |
| switch-to-luna | 3 | gpt-5.6-luna | 2 | 19478 | 15465 | 4007 | 243 | 0.16 |  |

Easy turns after the hard Sol turn: stay on Sol 3.60 | switch to Luna 0.38 | same two turns in a fresh Luna session 0.54 | fresh Sol find-a-value alone 3.72

## T5 HydraFusion: minimal prompt vs original one-liner (build only, one turn)

| Prompt | Run | Route | Credits | Luna requests | Gate | tty-smoke | Python lines | Record |
| --- | ---: | --- | ---: | ---: | --- | --- | ---: | --- |
| original one-liner | | critique gpt-5.6-luna+gpt-5.6-terra | 1.38 | 7 | pass | | | `greenfield/pong3-hydrafusion-build/fusion-report.json` |
| original one-liner (2-turn run, build turn) | | critique gpt-5.6-luna+gpt-5.6-terra | 31.44 | 55 | pass | | | `greenfield/pong5-hydrafusion-two-turn/fusion-report.json` |
| original one-liner, runs 2–3 (round 2, folders not kept) | | critique | 1.25 / 25.30 | | | | | HANDOFF-2 |
| **minimal (new)** | 1 | critique gpt-5.6-luna+gpt-5.6-terra | 0.99 | 4 | pass | pass | 117 | `greenfield/t5-fusion-minimal-1` |
| **minimal (new)** | 2 | critique gpt-5.6-luna+gpt-5.6-terra | 1.08 | 5 | pass | pass | 123 | `greenfield/t5-fusion-minimal-2` |
| **minimal (new)** | 3 | critique gpt-5.6-luna+gpt-5.6-terra | 1.25 | 8 | pass | pass | 122 | `greenfield/t5-fusion-minimal-3` |

CLI: GitHub Copilot CLI 1.0.87.. Generated 2026-09-22T12:34:46.891Z by experiments/summarise-round3.mjs.
