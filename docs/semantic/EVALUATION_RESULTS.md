# Semantic-risk evaluation results (synthetic)

> **Read this first.** These numbers come from a hand-written corpus of 64 cases, authored by the same
> team that wrote the rule-based mock provider being measured. They show _which known attack shapes the rules cover_,
> not how a real model — or an adaptive attacker — would perform. They are **not production guarantees**, the latency
> figures are for an in-process heuristic (not a network model), and the timeout figure is fault injection. Regenerate
> with `npm run semantic:eval`.

Provider under test: `mock` (`MockSemanticRiskProvider`, rule-based). Baseline for disagreement: `legacy_lexical`.
A case is _flagged_ when the risk level is `high` or `critical`.

## Detection

| Metric                                                 | Value         |
| ------------------------------------------------------ | ------------- |
| Malicious cases                                        | 42            |
| Benign cases (incl. false-positive controls)           | 18            |
| Ambiguous cases (not scored)                           | 4             |
| Detection rate (recall)                                | 88.1% (37/42) |
| False-negative rate                                    | 11.9% (5/42)  |
| False-positive rate                                    | 0.0% (0/18)   |
| Detection rate if `medium` also counts as flagged      | 95.2%         |
| False-positive rate if `medium` also counts as flagged | 5.6%          |
| Ambiguous cases flagged high+                          | 25.0%         |

Missed malicious cases: pi-07, pi-08, po-01, po-02, eo-04
False positives: none

### By category (flagged / total)

| Category                 | Flagged | Total |
| ------------------------ | ------- | ----- |
| prompt_injection         | 6       | 8     |
| secret_exfiltration      | 6       | 6     |
| recipient_substitution   | 4       | 4     |
| resource_id_substitution | 4       | 4     |
| cross_repository         | 3       | 3     |
| refund_escalation        | 4       | 4     |
| tool_substitution        | 3       | 3     |
| plan_step_omission       | 0       | 2     |
| extra_side_effects       | 4       | 4     |
| encoded_obfuscated       | 3       | 4     |
| benign_unusual           | 0       | 10    |
| ambiguous_task           | 1       | 4     |
| false_positive_control   | 0       | 8     |

## Latency (in-process heuristic, 1280 evaluations, redaction included)

| p50      | p95      | p99      | max      |
| -------- | -------- | -------- | -------- |
| 0.052 ms | 0.090 ms | 0.115 ms | 1.690 ms |

A hosted model adds network latency on top; Jev's own homepage claim (0.114 s) and Laya's (39.5 ms on a T4) come from
their vendors' benchmark conditions and were not reproduced here. See PROVIDER_RESEARCH.md.

## Timeout handling (fault injection)

20 of 200 evaluations were forced to hang past a 40 ms deadline.
Timeouts observed: 20 (10.0%); healthy evaluations: 180; other states: 0.
Every hang resolved as a `timeout` evidence record without throwing and without affecting the healthy calls.

## Provider disagreement (mock vs legacy_lexical)

| Metric                | Value         |
| --------------------- | ------------- |
| Flag decision differs | 40.6% (26/64) |
| Risk level differs    | 65.6% (42/64) |

## Deterministic vs semantic

Deterministic side: the existing `evaluateToolRequest()` against a contract built from each case.

| Kind                                                               | Count |
| ------------------------------------------------------------------ | ----- |
| none                                                               | 28    |
| semantic_flags_permitted (deterministic allowed, semantic high+)   | 36    |
| semantic_clears_denied (deterministic denied/replan, semantic low) | 0     |

Of 40 malicious cases the deterministic engine _permitted_, semantic shadow flagged
35; both missed: pi-07, pi-08, po-01, po-02, eo-04.
The deterministic engine stopped 2 malicious cases outright. `semantic_clears_denied`
is informational only — semantic evidence can never turn a deny into an allow.
