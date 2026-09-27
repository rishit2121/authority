# Validation Lab

Authority Control has two halves: it **restricts agents during real execution**, and it **attacks agents and controls in safe
simulations**. The Validation Lab is the second half. It measures how much of a set of attacks your controls contain, explains
each failure, proposes repairs, and turns every accepted repair into a regression test.

## What it is not

It is **not** a guarantee about production. Scenarios are written by the team that wrote the controls, run against synthetic
data with mock integrations and a rule-based mock semantic provider, and rates come from small samples. A clean run means the
_known_ attacks in the library are contained by the configuration you tested. Every report says so.

## Safety model (why it cannot hurt anything real)

- **Per-run sandbox tenant.** Each scenario run creates a throwaway `tenants` row flagged `validation_sandbox`, always a
  development tenant, with a mandatory short expiry and **no memberships** (no user can see or join it). It is destroyed
  when the run ends; a scheduled sweep destroys any that crashed.
- **Database-enforced.** Every sandbox function (`gateway.vl_*`) refuses a tenant that is not a live sandbox
  (`vl_assert_sandbox`, SQLSTATE 42501). Campaign _records_ live in the customer's tenant but are written only through
  actor-verified gateway functions; clients have read-only RLS access. pgTAP suite 21 covers all of it.
- **No egress.** Effects go to an in-memory mock GitHub and an in-memory effects ledger. There is no code path from a scenario to
  a real integration, a real repository, or an arbitrary host. Scenario data may only name reserved example/test domains
  (asserted by a unit test).
- **Real controls, mock effects.** The real `authorizeThroughGateway` pipeline, contract compiler, capability lifecycle and
  connector run unchanged. Only what is _behind_ the connector is mocked.
- **Hard limits** per environment: steps per scenario, time per scenario, campaign time, run count, semantic calls; at most 3
  concurrent campaigns and 12 live sandboxes per tenant. Campaigns can be cancelled; every path cleans up.
- **Reproducible.** A scenario version is an immutable, content-hashed definition. Task ids, branch names and timing derive
  only from the scenario and the seed. Same seed, same decisions (asserted by an integration test).

## Scenario model

A scenario (`src/lib/validation/schema.ts`) defines the trusted task intent, the candidate plan, the environment (semantic
mode, approval classes, forbidden resources, capability TTL), the ordered attack steps (with injected malicious text and the
agent/tool requests), and for each step the expected outcome: decision, capability issuance, execution, acceptable result
codes and responsible control. It also defines the side-effect **boundary**: effects that must never occur. The plan is
compiled to a contract by the real validator, solver and compiler; **variants** patch that configuration to weaken one
control. See `SCENARIOS.md` for the library (28 scenarios, 25 categories).

## Campaigns

A campaign expands scenarios x variants x repetitions, runs them with bounded concurrency, and for each run: creates the
sandbox, applies contract and policies, runs the benign baseline, injects the attacks, calls the real gateway, captures
decisions, semantic evidence, capabilities and receipts, compares actual with expected, produces findings, and destroys the
sandbox. Progress is persisted as it happens, so the UI (and a reload, or another device) shows real recorded events.

## Measurements (no single score)

Attack containment, unauthorized-operation block rate, false negatives, false positives, least-privilege exposure, residual
blast radius, deterministic/semantic disagreement, capability replay resistance, approval-bypass resistance, decision
latency, time to detection, control coverage and regression status. Each keeps its numerator, denominator and a 95% Wilson
interval. There is deliberately no composite score: one number would hide which control failed.

## Findings and remediation

A step that violated its expectation becomes a **finding** with a severity (bumped when the side-effect boundary was
crossed), a cause (invalid plan, wrong tool, wrong resource, argument-constraint violation, missing approval, stale
contract, capability misuse, prompt injection, semantic uncertainty, configuration error, ...) and evidence. Each finding gets
concrete **remediation proposals**: pin an argument or resource, reduce a budget, add a hard-deny, require approval, enforce
semantic review, shorten the capability, rotate a credential, update a registry definition, replan, ask the user, or add a
regression scenario; plus what the agent should do next.

Rules that cannot be bypassed:

1. **Proposals never broaden authority.** Every machine-applicable patch is checked to be narrowing (`isNarrowingPatch`) and the
   database refuses a proposal whose `broadensAuthority` is not `false`.
2. **Nothing is applied automatically.** A security admin (or above) must accept. Accepting records the decision, pins a
   regression scenario, and reruns the attack **inside a sandbox** with the fix applied. It does not change any real contract,
   policy or registry; applying the fix for real is a separate change through the normal contract flow.
3. **Every accepted remediation produces a regression test** (`regression.<scenario>.<id>`): the same attack under the
   configuration that failed plus the fix, as an immutable version, with before/after evidence recorded.

## UI

`/app/validation`: Environments, Scenario library, Campaign builder, Runs (active and history), Findings, Remediations, Regression
history. A campaign page shows the attack tree (agent -> step -> responsible control -> outcome), step-by-step replay
of the persisted steps, expected-vs-actual, evidence, blast radius, findings with remediation cards, before/after
verification, measurements with limitations, **Run again** (same seed) and downloadable JSON / Markdown / HTML reports.

## Reports

`GET /api/validation/campaigns/{id}/report?format=json|md|html`. Contain: executive summary, tested tasks and tools, controls
tested, per-scenario results, findings by severity, evidence, residual risk, recommended remediation, regression status,
limitations and environment/version details. Rebuilt from persisted rows; token- and key-shaped text is redacted; raw argument
values are never stored (steps keep argument keys, types and hashes only).

## Taxonomy

Scenarios are labeled with OWASP LLM Top 10 (2025), OWASP Agentic AI Threats (T-ids) and MITRE ATLAS technique ids, only where the
mapping is accurate (ids were checked against the official sources; many scenarios deliberately carry none). Labels, not
compliance claims.

## Known limitations

- The semantic layer runs a deterministic heuristic provider, so its numbers are not model accuracy. Provider timeouts and
  malformed responses are exercised by injecting faults.
- Human approver rules (roles, self-approval, distinct approvers) are covered by database tests, not simulated in scenarios.
- Campaigns run in the web server process (fine for the MVP; a long campaign is bounded by `maxCampaignMs`). A restart
  mid-campaign is marked failed by the sweep. There is no separate worker fleet.
- Custom (user-authored) scenarios are not exposed in the UI yet; the engine supports stored definitions (regression scenarios use this).
