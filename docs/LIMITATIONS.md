# Supported limitations

What Authority does not do, or does only partly. Each item is either a design boundary or a known gap, with what
to do about it. The guarantees Authority does make are in [SECURITY.md](SECURITY.md).

## Read these first

These four points most often lead to wrong assumptions. Each is described in more detail further down.

1. **Budgets reset with every contract version.** `maxInvocations` limits calls within one contract version, not
   across a task's lifetime. Re-preparing a task creates a new version with full budgets, so a backend that
   re-prepares three times allows three times the calls. Authority has no cross-version ceiling. If you need one,
   enforce it in your backend.
2. **Unresolved security-relevant derived values are unsupported.** A recipient, channel, id, path, branch or amount
   that would come from an earlier step's output cannot be authorized. Authority does not defer it or check it at
   runtime. Prepare excludes the step (`excludedSteps`, status `clarify`). Resolve the value in your trusted
   backend, then prepare with it pinned. Only free text (a body, subject, title or description) may come from an
   earlier step, and Authority does not check where that text came from.
3. **Backend prepare skips Jev checks.** `POST /api/v1/tasks/{taskId}/prepare` never runs Jev necessity or
   completeness, whatever the tenant's `jev_settings` say. Only plans proposed in the dashboard go through Jev. A
   contract prepared from your backend has passed the deterministic validator, solver, compiler and verifier, and
   nothing model-based.
4. **Simulated execution is not provider execution.** `POST /api/v1/capabilities/consume` spends a capability and
   records the step as `simulated`. It calls no provider, sends nothing and changes nothing outside Authority. Its
   success does not show that a provider would accept the call. Connector tools are refused there
   (`409 CONNECTOR_EXECUTION_REQUIRED`) and run through `/execute`. This repository's tests follow the same line.
   The local real-API evaluation calls no provider. The cross-entrypoint and execution-race suites execute against a
   controllable mock provider (`src/tests/local/mock-provider-fixture.ts`). Neither is evidence about how a real
   provider behaves.

## Scope of enforcement

- **Only calls routed through Authority are governed.** An agent that holds other credentials, or an execution
  environment that acts directly (a browser following a link or submitting a form, a shell, page scripts), is outside
  the boundary. Put controls at that execution boundary (network egress policy, sandboxing).
- **A contract is as good as its plan.** The validator checks a plan is well formed and policy-compliant; the solver
  finds the minimum catalog permissions that cover it; the compiler pins its values. None of these proves the plan is
  what the user meant. Optional task-alignment review gives model-based evidence, not proof.
- **Minimum permission coverage is not a narrower provider credential.** The solver selects the narrowest catalog
  permissions for the submitted plan. The provider-side OAuth token Authority holds may still be broad; the contract
  is what narrows each call.
- **No "mechanical necessity" check exists.** The backward slice over a plan's dependency graph contains every step
  of any valid plan, so it cannot show a step is unnecessary (`src/lib/authorization/backward-slice.ts`).

## Values and arguments

- **Exact-match pins only.** The compiler emits `equals` constraints. A pattern (`/checkout/*`) or a range cannot be
  expressed through a plan, and an equivalent value spelled differently (another host alias, a trailing slash, a
  number sent as `4900.0`) is refused. Lists cannot be pinned at all: a plan that sets a list argument is refused.
- **Data flow is for free text only.** A step may take a message body, subject, title or description from an
  earlier step's output; Authority neither checks where it came from nor constrains it at runtime. A recipient,
  channel, id, path, branch or amount must be concrete in the plan, so "reply to the sender of message X" needs the
  sender known in advance. Receipt-derived provenance is proposed, not built
  ([proposals/PROVENANCE_AND_BOUNDED_REPLANNING.md](proposals/PROVENANCE_AND_BOUNDED_REPLANNING.md)).
- **Free text is unconstrained.** A body or title the plan left open can say anything. Content screening may flag
  it; nothing deterministic limits it.
- **Only optional free-text fields can be left for the agent to write.** A required field (Slack's `text`, an
  email `subject`, an issue `title`) must be pinned in the plan or taken from an earlier step by data flow; a plan
  that leaves it open has that step excluded (`excludedSteps`, status `clarify`).
- **Contracts compiled before closed-world arguments** (compiler versions before `authority-compiler-2026-10-23-9`)
  accept extra argument keys until re-prepared. A deploy of the current compiler retires them.

## Budgets and replanning

- **Budgets belong to a contract version.** Re-preparing a task (backend credential only) produces a new version
  with a fresh budget; nothing carries over. A task-wide ceiling across versions is not implemented; enforce one in
  your application if you need it.
- **Changing a task's scope means re-preparing.** There is no bounded "child authorization" inside an envelope yet;
  a new recipient or a higher amount needs a new plan from the trusted backend (or a person). Proposed, not built.

## Model-based checks (optional, narrow-only)

- **Task alignment, content screening and risk review are probabilistic.** They can only narrow a deterministic
  decision. "Not inspected" and "unreviewed" are never a pass.
- **Content screening sees only what is submitted to it** (`/tasks/{id}/content`) and connector results Authority
  itself returns. It does not see everything in an agent's context, and it does not sanitize content.
- **Shadow evidence is best effort.** Shadow-mode reviews run after the response and are lost if the process stops
  first; a decision with no shadow review means "not reviewed".
- **Reviewer budgets are per process.** `ALIGNMENT_MAX_REVIEWER_CALLS` is exact under concurrency within one server
  process; the token cap can be overrun by requests in flight. Neither is an account-wide or per-tenant spending
  limit.
- **Entrypoints differ in optional checks.** Jev necessity/completeness runs only on dashboard proposals; task
  alignment plan review runs only on backend `prepare`. See [ENFORCEMENT_PROFILE.md](ENFORCEMENT_PROFILE.md). The
  deterministic core is the same everywhere.

## Verification

- **The contract verifier is a consistency check.** It re-runs the same validator, solver and compiler, so a mistake
  shared by the compiler and the verifier passes both. Independent checks are the mutation tests and the separately
  specified contract checker in `src/tests/unit/authorization/contract-mutation.test.ts`. There is no formal proof.
- **Test evidence is limited to what is tested.** The pgTAP suites, unit tests and the local real-API evaluation
  exercise the deterministic boundary with synthetic data. Execution and disconnect races are tested only against a
  mock provider, in-process and not under load. The tests do not cover real provider behavior or model accuracy.

## Connectors

- **PostgreSQL read queries** are classified by text and run in a read-only transaction. That refuses writes inside
  the transaction, including from functions, but not side effects of extensions that open their own connections, and
  it is not a proof a query is harmless. Use a database role with only the grants the queries need.
- **No general reconciliation for uncertain writes.** A connector write whose outcome is unknown is recorded as
  indeterminate and never retried automatically.
- **MCP drops undeclared argument keys instead of refusing them.** The MCP bridge validates arguments against each
  tool's declared schema, which removes keys the schema does not declare before Authority sees the call. The call is
  then authorized and run without them. The REST API refuses the same call (`CONSTRAINT_VIOLATION`). A key the
  schema declares but the plan did not pin is refused on both.
- **MCP `tools/call` does not de-duplicate retries.** MCP has no idempotency field, so each call gets a new key; a
  client that retries a timed-out write may execute it twice. The REST API and SDK take caller-supplied keys.

## Operations

- **Not a WAF or rate limiter**, beyond per-key-prefix limits on failed authentication.
- **A leaked `GATEWAY_DATABASE_URL` or a compromised database superuser defeats the model.** Rotate with
  `npm run gateway:provision`.
- **The in-process maintenance scheduler runs only while the server is awake** (`docs/ops/OPERATIONS.md`).
- **No third-party audit or compliance certification.**
