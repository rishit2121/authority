# Jev evaluation results (synthetic, mock providers)

> **Read this first.** These numbers come from a small, hand-written corpus (7 necessity cases,
> 5 risk cases) authored by the same team that wrote the rule-based mock providers being measured
> (`MockNecessityProvider`, `MockRiskProvider`). They demonstrate the evaluation harness and the mock's own rules —
> **they are not live Jev model accuracy** and must never be reported as such. Regenerate with `npm run jev:eval`.
> Once `OPENROUTER_API_KEY` and `OPENROUTER_JEV_DECISION_MODEL` are configured, pass a real
> `OpenRouterJevNecessityProvider` / `OpenRouterJevRiskProvider` to `evaluateNecessityCorpus` /
> `evaluateRiskCorpus` to measure the real model instead — see docs/jev/SETUP.md.

## Necessity (role B)

| Metric                                       | Value                          |
| -------------------------------------------- | ------------------------------ |
| Cases                                        | 7                              |
| Accuracy (exact classification match)        | 85.7% (6/7, 95% CI 48.7–97.4%) |
| **False-"required" rate (highest priority)** | 20.0% (1/5, 95% CI 3.6–62.4%)  |

False-"required" cases: necessity-false-required-consumed-duplicate
All misclassifications: necessity-false-required-consumed-duplicate

### By category

| Category            | Correct | Total |
| ------------------- | ------- | ----- |
| required            | 2       | 2     |
| unjustified         | 2       | 2     |
| conditional         | 1       | 1     |
| ambiguous           | 1       | 1     |
| false_required_risk | 0       | 1     |

## Runtime risk (role C)

| Metric                                                                       | Value                            |
| ---------------------------------------------------------------------------- | -------------------------------- |
| Cases                                                                        | 5                                |
| Accuracy (exact class match)                                                 | 100.0% (5/5, 95% CI 56.6–100.0%) |
| Detection rate (high/critical ground truth, flagged high/critical)           | 100.0% (2/2, 95% CI 34.2–100.0%) |
| False-positive rate (low/medium ground truth, wrongly flagged high/critical) | 0.0% (0/3, 95% CI 0.0–56.2%)     |

Misclassified: none

### By category

| Category                | Correct | Total |
| ----------------------- | ------- | ----- |
| in_plan_allowed         | 2       | 2     |
| not_in_plan             | 1       | 1     |
| not_allowed_by_contract | 1       | 1     |
| budget_exhausted        | 1       | 1     |

## Limitations

- Synthetic, small-sample corpus — confidence intervals above are wide and are Wilson 95% intervals, not a
  precision claim.
- Written by the same team that wrote the mock providers under test; a passing run shows the mocks' own rules are
  exercised correctly, not that a live model would agree.
- No case here has been run against a real, authenticated Jev model (see docs/jev/OVERVIEW.md's limitations and
  docs/jev/SETUP.md's live-test steps).
