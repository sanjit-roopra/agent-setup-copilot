# Model choices and costs

Checked 2026-09-17 against [GitHub's published pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).
USD per million tokens, default context tier. These are consumption prices, not
predicted monthly bills or measures of model quality.

| Model | Input | Cached input | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna | 0.20 | 0.02 | 0.25 | 1.20 |
| MAI-Code-1.1-Flash | 0.20 | 0.02 | n/a | 1.20 |
| GPT-5.4 nano | 0.20 | 0.02 | n/a | 1.25 |
| GPT-5 mini | 0.25 | 0.025 | n/a | 2.00 |
| GPT-5.4 mini | 0.75 | 0.075 | n/a | 4.50 |
| Gemini 3.8 Flash | 0.75 | 0.075 | n/a | 3.75 |
| Claude Haiku 4.5 | 1.00 | 0.10 | 1.25 | 5.00 |
| Claude Sonnet 5 | 2.00 | 0.20 | 2.50 | 10.00 |
| GPT-5.6 Terra | 2.00 | 0.20 | 2.50 | 12.00 |
| GPT-5.6 Sol | 4.00 | 0.40 | 5.00 | 20.00 |
| Claude Opus 5 | 5.00 | 0.50 | 6.25 | 25.00 |
| GPT-6 Astra | 10.00 | 1.00 | 12.50 | 50.00 |

Gemini's quoted price is promotional through 2026-12-31. Luna above 200K input
uses $0.40 input / $0.04 cached / $0.50 cache-write / $1.80 output. Other long
context tiers also change prices; consult the source rather than extrapolating.

## Choices in this change

- **Explore and Task: Gemini Flash -> Luna.** These bounded retrieval and command
  reporting tasks are the first candidates for a cheaper model. At identical token
  counts and default context, Luna's uncached input rate is 73.3% lower and its
  output rate is 68% lower than Gemini 3.8 Flash. This is a price calculation, NOT
  an observed end-to-end saving. Cache creation, retries and quality can change it.
- **General Purpose: keep Gemini 3.8 Flash.** It is already economical. Changing
  implementation quality without a representative evaluation is not justified by
  unit prices. Luna and MAI-Code are candidates for an optional later experiment.
- **Coordinator: explicitly pin Sol.** Avoid an arbitrary expensive session default,
  while retaining a powerful-tier coordinator for specialist dispatch. It receives
  short worker results, not source dumps. This is not the cheapest model, and a
  cheaper parent can prevent higher-tier specialists from running in VS Code.
- **Code Review, Rubber Duck, Research and Security Review: preserve existing pins.**
  Restrict their scope and context before downgrading judgment. Rubber Duck runs
  only for material uncertainty, research/security only on explicit request.

## Cheaper alternatives worth testing

MAI-Code has the same base input/output price as Luna without a separately listed
cache-write charge. It may be cheaper for some cache patterns. GPT-5.4 nano is also
priced low, but price alone does not establish sufficient coding/retrieval quality.
Claude Sonnet 5 is a candidate for Rubber Duck at 60% lower input/output rates than
Opus 5. That swap is intentionally not automatic: compare missed findings and
unnecessary review comments on your actual repositories first.

For model availability, verify the [supported-model list](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
and the account's model picker. The docs list VS Code 1.128.0 for Luna/Sol/Terra and
1.136.1 for Astra; some models have additional rollout or policy restrictions.
A model listed on GitHub is not proof it is enabled for your company or client.

## Copilot versus another harness/provider

[Business/Enterprise billing](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/billing-and-usage/organizations-and-enterprises/billing)
uses AI credits (one credit = $0.01) and pools included consumption. Worker usage
is still billed. Model-token savings reduce overage only when consumption would
otherwise exceed included credits; they do not reduce the fixed seat charge.

OpenCode or Pi with the same Copilot connection does not inherently change the
provider's unit prices. A separate model API adds another bill and may leave paid
Copilot credits unused. This change therefore keeps workers inside Copilot. It
makes no claim to have benchmarked every external provider, negotiated enterprise
contract, or self-hosted alternative. Compare total accepted-task cost before
switching vendors, including API usage, engineering maintenance and failed tasks.

## Company controls

Use model-availability policies and per-user budgets alongside these local guards.
GitHub's [budget guide](https://docs.github.com/en/enterprise-cloud@latest/copilot/tutorials/budgets/getting-started-with-budget-controls)
explains universal user limits, individual overrides and enterprise limits. Enable
"Stop usage when budget limit is reached" where applicable; an alert alone is not
a hard cap. Budget exhaustion does not automatically route work to a cheaper model.

Evaluate the original fleet and this version on matched tasks. Track all-agent
credits per accepted task, latency, retries, review defects and human rework. The
cheapest useful model is the one that minimizes that total, not merely input price.
