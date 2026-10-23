# TypeSafe Jev, via OpenRouter

> **Status:** implemented and unit-tested end to end, running against mocks and (where a schema/prompt shape is all
> that's being checked) a real unauthenticated probe of OpenRouter's endpoints. **No call against a real, authenticated
> Jev model has been made yet** — that requires `OPENROUTER_API_KEY`, which is not present in this environment. See
> `docs/jev/SETUP.md` for exactly what to do once it is.

## What Jev is for, and what it is not

Jev is a second, independent opinion layered on top of Authority's existing deterministic authorization pipeline
(registry → policy checks → mechanical validation → minimum-authority solver → compiler → verifier → human approval →
gateway → capability). It answers two narrow questions a purely mechanical pipeline cannot:

1. **Necessity** — is a tool the deterministic pipeline found _reachable_ also _actually needed_ for this task? (Role
   B.)
2. **Runtime risk** — does a specific tool call, at the moment it happens, look like it diverges from the plan that
   was authorized? (Role C.)

Jev **never** authorizes anything. It cannot invent a tool, name a permission, see a capability, produce SQL, choose a
URL or HTTP method, rewrite the task, or issue a final allow/deny. Every identifier it is allowed to name (a
predecessor node, an alternative operation, a missing-information code, a risk-evidence code) comes from an allowlist
Authority itself supplies for that one call; Jev selects from it, it never extends it. The registry, policy engine,
mechanical validator, exact minimum-scope solver, compiler, verifier and approval lifecycle are unmodified and remain
the entire security boundary.

## Verified facts about the API (do not assume otherwise)

Confirmed directly against OpenRouter's public model listing and docs during this implementation (2026-09-29):

|                                              | `typesafe/jev-router`                                                                                                                                                                                                                           | `typesafe/jev-1.13`                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Used for                                     | Role A: candidate-plan proposal                                                                                                                                                                                                                 | Roles B & C: necessity + risk decisions                                                                                                                                                         |
| Endpoint                                     | `POST {OPENROUTER_BASE_URL}/chat/completions` (standard OpenAI-compatible chat completions)                                                                                                                                                     | `POST https://openrouter.ai/api/alpha/decisions` — a **sibling** of `/api/v1`, not nested under it, and marked **alpha** by OpenRouter itself                                                   |
| Context                                      | ~1,000,000 tokens                                                                                                                                                                                                                               | ~32,000 tokens                                                                                                                                                                                  |
| Pricing (as listed)                          | pass-through / "-1" sentinel pricing in OpenRouter's own API — **not confirmed to be free**; do not assume $0                                                                                                                                   | $0.042 / M input tokens, $0 / M output tokens, at time of writing                                                                                                                               |
| Output shape                                 | Free-form chat completion; Authority asks for and validates structured JSON against `candidatePlanSchema`, and treats anything else as a provider error, never a partial success                                                                | Native typed decision primitives: `choice` (`{choice, confidence, probabilities}`), `noul` (`{noul: probability}`, no confidence field), `score` (`{score, confidence, probabilities, legend}`) |
| Does it "route" to another underlying model? | Yes — OpenRouter's own routing may answer with a different model than the one named. Authority records both the requested and the actually-responding model (`PlanProposalMetadata.model` vs `.respondedModel`) whenever the provider tells us. | No — this is Jev's own decision model called directly, not routed.                                                                                                                              |

**Do not invent a model slug, and do not treat `jev-router` and the direct `jev-1.13` decision model as the same
thing.** They are different endpoints with different output shapes, different guarantees, and (per OpenRouter) the
router may not even be Jev underneath for a given request. `OPENROUTER_PLAN_MODEL` and `OPENROUTER_JEV_DECISION_MODEL`
are deliberately separate environment variables for this reason — see `src/lib/openrouter/env.ts`.

Because the Decisions API is alpha and unauthenticated probing is all that was possible without a key, **pricing,
rate limits and exact response shape should be re-checked against OpenRouter's live docs before enabling billing- or
latency-sensitive usage** — this table is a point-in-time record, not a guarantee.

## The three roles, precisely

### Role A — candidate-plan proposal (`typesafe/jev-router`)

- Lives behind the existing `PlanProposalProvider` port (`src/lib/ai/openrouter-jev-router-plan-proposal-provider.ts`),
  the same interface `OpenAiPlanProposalProvider` and `MockPlanProposalProvider` implement.
- Selected in `generatePlanWithAiAction` only when `OPENAI_API_KEY` is absent and `OPENROUTER_API_KEY` is present — an
  existing OpenAI setup's behavior never changes merely because OpenRouter was added. Falls back to the labeled mock
  when neither is configured.
- Its output is **untrusted from the moment it exists**. It is shown to the user labeled as AI-generated and unvalidated,
  and must pass through the exact same `validateCandidatePlanAction` / `proposeContractAction` pipeline as a
  hand-authored plan — nothing about this provider skips or weakens validation. If `jev-router` cannot reliably
  produce output matching `candidatePlanSchema`, that surfaces as `validationError` in the UI rather than being
  silently coerced or accepted.

### Role B — per-tool necessity + plan completeness (direct `typesafe/jev-1.13`)

**Per-tool necessity** (`src/lib/jev/necessity-provider.ts`, `openrouter-necessity-provider.ts`,
`necessity-runner.ts`, `contract-pipeline.ts`): for every plan node that mechanical validation already accepted (or
flagged for review), Jev is asked one bundled Decisions API call with:

- the classification question (`required | conditional | unjustified | ambiguous`),
- a `noul` per candidate predecessor node (restricted to that node's own declared `dependencies` — Jev cannot name a
  node outside that list),
- a `noul` per the registry operation's own `alternativeOperationIds` (never an invented tool),
- closed-vocabulary reason codes and missing-information codes (`NECESSITY_REASON_CODES`,
  `MISSING_INFORMATION_CODES` in `src/lib/jev/types.ts`) — never free text.

The trusted input never includes literal argument _values_ — only structure (which operation, which side effect,
which node depends on which). An agent-supplied justification, if any, is passed through labeled as testimony, never
as fact.

**Combination rules** (`applyNecessityRule` in `contract-pipeline.ts`), gated by the tenant's
`jev_settings.necessity_mode` (`off` default / `shadow` / `enforce`, mirroring `semantic_settings`'s vocabulary):

| Mechanical result                              | Jev classification                                 | `shadow`                         | `enforce`                                                                                    |
| ---------------------------------------------- | -------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| any                                            | (Jev unavailable / timeout / error / circuit-open) | unchanged, recorded              | mechanical `accepted` → `requires_review`; never silently kept as approved                   |
| rejected already (`denied`/`clarify`/`replan`) | not consulted                                      | unchanged                        | unchanged — Jev is never consulted for a node mechanical validation already rejected         |
| accepted / requires_review                     | `unjustified`                                      | unchanged, disagreement recorded | → `replan`                                                                                   |
| accepted / requires_review                     | `ambiguous`                                        | unchanged, disagreement recorded | → `clarify`                                                                                  |
| accepted / requires_review                     | `conditional`                                      | unchanged, disagreement recorded | → `requires_review` (no machine-verifiable-condition mechanism exists yet — see Limitations) |
| accepted / requires_review                     | `required`                                         | unchanged                        | unchanged — Jev never _upgrades_ a status; it can only leave it or narrow it                 |

The output, `adjustedValidation`, has exactly the same shape and invariants as the original `PlanValidationResult` and
is passed unmodified into the existing `solveMinimumAuthority()` / `compileContract()` — neither of those, nor the
verifier, know or care that Jev ran.

**Plan-level completeness** (`completeness-provider.ts`, `completeness-runner.ts`, wired via
`propose-integration.checkPlanCompleteness`): a separate, once-per-proposal check for a whole missing _category_ of
step the plan never proposed at all — something per-tool necessity structurally cannot notice, since it only ever
judges tools that are already in the plan. Candidate "possibly missing" operations are restricted to registry
operations sharing a `provider` namespace (e.g. `github`) with an operation already used in the plan, excluding tools
already present — never an invented tool, never the entire registry. This check shares `necessity_mode`'s gate but is
**always advisory only**, in every mode: it can only ever surface `possibleMissingOperationIds` for a human to look
at; it never adds, removes or reorders a plan node.

### Role C — runtime semantic risk (direct `typesafe/jev-1.13`, shadow only)

`src/lib/jev/risk-provider.ts`, `openrouter-risk-provider.ts`, `risk-runner.ts`, wired into
`src/lib/gateway/pipeline.ts`'s `runShadowRiskEvaluation`. Fired **after** `commitAuthorization` has already
succeeded, **never awaited** (`void runShadowRiskEvaluation(...)`) — a Jev outage, timeout, or the recording write
itself failing can add no latency and can never affect the authorization decision, which is already final and
persisted by that point. The entire function is wrapped in try/catch and never throws. The resulting record is
best effort: if the process stops before the evaluation finishes, no record is written and nothing retries it.

Gated by `jev_settings.risk_mode`, which is **structurally `off` or `shadow` only** — there is no `enforce` value the
schema can represent yet (a `check` constraint on `jev_settings.risk_mode`), so enforcement is not merely
default-off, it is currently impossible to turn on without a future migration and its own explicit approval flow.

Jev is given: the tool/operation/resource, argument _keys_ only (never values), whether the call was in the proposed
plan and its expected node id, the contract's allowed tools, remaining invocations, and time to contract expiry — never
raw secrets, capability tokens, or full argument values. It returns a `riskClass` (`low`/`medium`/`high`/`critical`,
with confidence), zero or more closed-vocabulary `categories` (e.g. `task_divergence`, `secret_access`,
`cross_tenant_attempt`), and zero or more closed-vocabulary `evidenceCodes` describing _what was observed_, never a
decision. A coarse `disagreement` flag is computed (risk class points one way, the final decision went the other) —
advisory only, never itself a decision, and recorded alongside, never gating anything.

## Data flow: the full contract-creation pipeline, in order

1. Trusted task (stored intent, never agent-supplied at authorization time)
2. Candidate plan (untrusted — hand-authored, or Role A output, always re-validated regardless of source)
3. Schema validation (`candidatePlanSchema`)
4. Registry resolution
5. Hard policy checks
6. Deterministic dependency / data-flow validation (`validateCandidatePlan`)
7. Structural backward slice (`computeBackwardSlice`, no LLM). Not a necessity check: for a validated (acyclic)
   plan every node is in the slice, so it never excludes a step. See `backward-slice.ts`.
8. Role B necessity evaluation per mechanically-accepted node
9. Disagreement / ambiguity handling per the combination-rule table above
10. Accepted operation set → `adjustedValidation`
11. Minimum-authority solver (`solveMinimumAuthority`, unmodified, authoritative)
12. Compiler (`compileContract`, unmodified)
13. Independent verifier (`verifyCompiledContract`, unmodified)
14. Human approval (unmodified)
15. Activation (unmodified) — re-runs the same Jev pipeline so the activation-time hash matches proposal time (see
    Limitations: this reintroduces a small non-determinism risk if Jev's own answer changes between calls)
16. Gateway / runtime authorization, with Role C shadow risk evaluation fired after commit

Role B's plan-completeness check runs in parallel with step 8, once per proposal (not per node), and never feeds back
into steps 9–15.

## Runtime decision composition

The deterministic decision **runs first and is final in every denial case**. Jev can never convert a deny into an
allow, and can never increase scope, TTL, invocation count, or resource breadth — there is currently no enforcement
path for risk evaluation at all (see Role C above), so today this is enforced simply by Jev's result never being
consulted in the composition logic, not by a narrowing rule that could someday be bypassed. Jev never receives raw
secrets or capability tokens (see the inputs listed under Role C).

A **future narrowing design** (not implemented, not enabled) is anticipated for when `jev_settings.risk_mode` gains an
`enforce` value: `low` → retain; `medium` → retain or require review per tenant policy; `high` → require approval;
`critical` → deny. This is written down here as the intended shape of a future migration, not as current behavior —
nothing in the schema or code paths enables it today.

## Persistence

Three new append-only, RLS-scoped tables (migration `20260930000017_jev_openrouter.sql`, with two follow-up
migrations fixing `agent_id` resolution and adding a side-effect-free risk-mode lookup):

- `jev_necessity_evaluations` — one row per (plan, node) evaluation.
- `jev_plan_completeness_evaluations` — one row per proposal.
- `jev_risk_evaluations` — one row per authorization decision (`unique (authorization_decision_id)`, exactly like
  `semantic_evaluations`), written only by the restricted `authority_gateway` role, never client-writable.

All three: RLS-scoped to `authz.is_member_of(tenant_id)`, `select`-only grants to `authenticated` (writes go only
through `SECURITY DEFINER` functions with `search_path = ''`), and an `authz.forbid_update_delete()` append-only
trigger — a row is never edited or deleted, only ever inserted.

**Persisted:** task/plan/node identifiers, tool/operation names, the registry and compiler versions in effect,
provider/model/model-version, a SHA-256 `inputHash` of the exact trusted input Jev was given (computed once, at
evaluation time, via `canonicalHash()` — never reconstructed later), the run state (`ok`/`unavailable`/`timeout`/
`error`/`circuit_open`), the typed result (schema-versioned JSON, capped at 4096 bytes) when the state is `ok`,
mechanical vs. final status, a computed disagreement flag, latency, and a closed-vocabulary error category.

**Never persisted:** any API key, runtime credential, capability plaintext, GitHub credential, raw secret, data from
another tenant, unredacted sensitive argument values, or a complete/unbounded prompt. Necessity evaluation never even
sees argument values in the first place (see Role B above); risk evaluation sees argument _keys_ only.

## Environment variables

| Variable                                        | Required                                        | Purpose                                                                                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENROUTER_API_KEY`                            | to enable any OpenRouter-backed feature         | Server-only. Never `NEXT_PUBLIC_`-prefixed, never in Supabase public config, never sent to browser code, never logged (see `src/lib/openrouter/env.ts`, scanned for in `scripts/lib/bundle-scan.mjs`). |
| `OPENROUTER_BASE_URL`                           | no (defaults to `https://openrouter.ai/api/v1`) | The `/v1` chat-completions base; the Decisions API path is derived from this by stripping a trailing `/vN`, never independently configurable to something arbitrary.                                   |
| `OPENROUTER_PLAN_MODEL`                         | no (defaults to `typesafe/jev-router`)          | Role A only.                                                                                                                                                                                           |
| `OPENROUTER_JEV_DECISION_MODEL`                 | to enable Roles B & C                           | No default — necessity and plan-completeness and risk evaluation all refuse to run (report unavailable) rather than guess a slug.                                                                      |
| `OPENROUTER_HTTP_REFERER`, `OPENROUTER_X_TITLE` | no                                              | Optional OpenRouter dashboard attribution headers, never authentication.                                                                                                                               |
| `OPENROUTER_DENY_DATA_COLLECTION`               | no                                              | Set to `1` to send `provider: { data_collection: "deny" }` on every request.                                                                                                                           |
| `OPENROUTER_ZDR_ONLY`                           | no                                              | Set to `1` to restrict routing to zero-data-retention providers.                                                                                                                                       |

Every HTTP response from OpenRouter is treated as `unknown` until validated (`src/lib/openrouter/client.ts`). 401,
402, 408, 429, 5xx, malformed output and model-unavailability are all distinct, explicitly-handled error categories
(`src/lib/openrouter/errors.ts`) — none of them are treated as "no signal" silently; they surface as a labeled
`unavailable`/`timeout`/`error` state in every persisted record and in the UI. There is deliberately **no production
fallback to a mock provider**: if OpenRouter is unavailable, every consumer reports a real degraded/unavailable state
rather than substituting a fake result.

## UI

- **Settings** (`/app/settings`, `JevSettingsForm`): tenant `necessityMode` / `riskMode` controls, enforcement
  approval gating (mirrors `SemanticSettingsForm`), and plan/decision-model configuration status (never a key value).
- **Contract proposal** (`CandidatePlanForm`): per-node table (tool, mechanical vs. Jev classification, confidence,
  final disposition, reason codes, less-privileged alternatives, a disagreement marker), a plan-level necessity
  summary (mode, tools proposed/accepted/removed-as-unnecessary), a plan-completeness panel, and — when a plan was
  AI-generated — the requested model alongside the actually-routed model when they differ.
- **Runtime dashboard** (`/app/runtime`): a "Jev risk (shadow)" column showing risk class, confidence, provider/model,
  latency and disagreement, and a matching step in the per-row decision trace. Every label makes clear this is
  shadow-mode evidence that never affected the decision shown in the adjacent, unchanged deterministic/final columns.

None of these surfaces ever claim Jev is authoritative or that it proves safety — every panel's own copy says so
explicitly.

## Current limitations (read before relying on this)

1. **No live-model verification yet.** Every typed-decision mapping (`buildNecessityQuestions` /
   `mapNecessityAnswers`, the risk and completeness equivalents) has been checked against the _documented_ Decisions
   API shape and exercised against mocks, but not yet against a real, authenticated response from `jev-1.13`. See
   `docs/jev/SETUP.md`'s live-test steps.
2. **`conditional` necessity has no machine-verifiable-condition mechanism.** It is currently treated the same as
   "needs human review" in enforce mode — safe (never silently approved) but not the more precise handling a future
   version could offer if conditions became checkable.
3. **Activation-time non-determinism.** `activateContractAction` re-runs the necessity pipeline so its hash check
   stays consistent with `proposeContractAction`, but a live model is not guaranteed to answer identically between
   the two calls. Today this can only cause a stricter re-classification (never a looser one — see the combination
   table), but it does mean activation could occasionally require review even though proposal did not.
4. **`database.types.ts` has not been regenerated** against the three new migrations (the linked project's Supabase
   Management API access token is expired — confirmed via a direct probe returning 401). All new-table access is
   through a documented, narrow `as unknown as` cast at the RPC/table-name boundary (the same technique already used
   elsewhere in this codebase), never a broader type-safety bypass. Regenerating types once the token is refreshed
   will let every one of these casts be deleted with no behavior change.
5. **pgTAP / integration / e2e verification is blocked by the same expired token.** RLS, append-only, and
   cross-tenant isolation for the three new tables follow the exact same, already-audited pattern as
   `semantic_evaluations` / `semantic_settings` (identical `authz.is_member_of` policies, identical
   `forbid_update_delete` trigger, identical restricted-role write path for the gateway table), but this has not been
   independently re-verified live against this project's own database for the new tables specifically.
6. **The evaluation harness and live-test command** (see `docs/jev/SETUP.md`) can run today against mocks; running
   them against a real model requires `OPENROUTER_API_KEY`.
