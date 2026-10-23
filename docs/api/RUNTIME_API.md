# Runtime API v1

Base path `/api/v1`. All endpoints return JSON with `Cache-Control: no-store` and an `X-Request-Id` header. Agents
authenticate with a runtime key: `Authorization: Bearer authority_rk_…`. No Supabase session is involved.
**Tools with a real connector (`github.*`) are executed via `POST /api/v1/github/execute`; their responses say `simulation: false`.** All other tools remain simulated (`simulation: true`).

## `POST /authorize` — authorize a call and issue a capability

Request (strict — unknown fields are rejected, including any tenant, principal, contract, policy or semantic result):

```json
{
  "taskId": "uuid",
  "tool": "github.get_issue",
  "operation": "get_issue",
  "resource": "acme/payments-api#991",
  "arguments": { "issue_number": "991" },
  "planNodeId": "uuid",
  "idempotencyKey": "1-200 chars",
  "maxUses": 1,
  "executionContext": {}
}
```

`resource`, `planNodeId`, `maxUses` (1–5, default 1) and `executionContext` are optional; `executionContext` is
validated and **never stored**. Limits: body ≤ 64 KB; ≤ 64 arguments; key ≤ 64 chars; string ≤ 4096; list ≤ 64 items;
arguments ≤ 16 KB (`413 PAYLOAD_TOO_LARGE`).

Response `200` (a decision — including a deny):

```json
{
  "decisionId": "uuid",
  "status": "allow | allow_constrained | replan | clarify | require_approval | deny",
  "reasonCodes": ["WITHIN_CONTRACT"],
  "summary": "Permitted.",
  "contract": { "id": "uuid", "version": 3 },
  "remainingInvocations": 4,
  "requiresApproval": false,
  "requiresClarification": false,
  "requiresReplan": false,
  "wasReplayed": false,
  "enforcement": { "mode": "off | shadow | enforce", "degraded": false, "narrowedBySecurityPolicy": false },
  "capability": {
    "id": "uuid",
    "token": "authcap_v1_…",
    "tokenAlreadyIssued": false,
    "tool": "github.get_issue",
    "operation": "get_issue",
    "expiresAt": "2026-…Z",
    "maxUses": 1
  },
  "simulation": true
}
```

`capability` is `null` unless the **final** decision is `allow`/`allow_constrained`. `capability.token` is present only in
the response that issued it. A response never contains credentials, provider keys, semantic signals, indicators, risk
levels, provider names or internal policy text; semantic outcomes appear only as the coarse reason codes below.

### Decision composition (what `status` means)

The deterministic engine decides first. In `enforce` mode a semantic verdict can only **narrow a deterministic allow**:
critical risk → `deny`, high risk → `require_approval`. Anything that is not a deterministic allow is final as-is. In
`shadow`/`off` the semantic result never changes the decision. If semantic evidence is _required_ for the call's risk
class and it times out, is malformed, unavailable or the circuit is open, the call fails closed (`deny`,
`SECURITY_REVIEW_UNAVAILABLE`); if optional, the deterministic result is kept and `enforcement.degraded` is `true`.

### Reason codes (agent-facing)

`TASK_NOT_EXECUTABLE`, `NO_ACTIVE_CONTRACT`, `CONTRACT_NOT_CURRENTLY_ACTIVE`, `UNSUPPORTED_CONTRACT_VERSION`,
`FORBIDDEN_RESOURCE`, `FORBIDDEN_OPERATION`, `TOOL_NOT_IN_CONTRACT`, `ARGUMENTS_UNDERSPECIFIED`, `CONSTRAINT_VIOLATION`,
`INVOCATION_LIMIT_REACHED`, `WITHIN_CONTRACT`, `SECURITY_POLICY_DENIED`, `APPROVAL_REQUIRED_BY_POLICY`,
`SECURITY_REVIEW_UNAVAILABLE`.

### Idempotency

`(task, idempotencyKey)` identifies a call. Retrying the same key with the same content returns the **same decision**
(`wasReplayed: true`) and the same capability id/expiry, but **never a second token** (`tokenAlreadyIssued: true`) and no
new budget or provider call. The same key with different content is `409 IDEMPOTENCY_CONFLICT`. If the response that
carried a token is lost, revoke the capability and retry with a new key.

## `POST /capabilities/consume` — simulated consumption

Headers: the agent's runtime key. Body: `{ capability, tool, operation, resource?, arguments, idempotencyKey }`.
The presented call must match the capability exactly (tool, operation, resource, argument hash; constraints are
re-checked). Nothing external is called.

`200` → `{ "result": "accepted", "capabilityId", "remainingUses", "expiresAt", "replayed", "simulated": true, "message": "SIMULATED — no external tool was executed." }`

Rejections return the error envelope with `error.code`:

| code                        | HTTP | meaning                                                                 |
| --------------------------- | ---- | ----------------------------------------------------------------------- |
| `CAPABILITY_NOT_FOUND`      | 404  | unknown, or another agent's/tenant's (indistinguishable)                |
| `SCOPE_MISMATCH`            | 403  | different tool, operation, resource or arguments than issued            |
| `CAPABILITY_ALREADY_USED`   | 409  | no uses left (a replay attempt; recorded)                               |
| `CAPABILITY_EXPIRED`        | 409  | past `expiresAt`                                                        |
| `CAPABILITY_REVOKED`        | 409  | revoked (by agent, admin or system)                                     |
| `CONTRACT_NO_LONGER_ACTIVE` | 409  | the contract was revoked/expired/superseded (capability revoked)        |
| `TASK_NO_LONGER_EXECUTABLE` | 409  | the task ended (capability revoked)                                     |
| `AGENT_OR_KEY_REVOKED`      | 409  | the agent or the key that requested it was revoked (capability revoked) |
| `IDEMPOTENCY_CONFLICT`      | 409  | same key, different call                                                |

Idempotency: same `idempotencyKey` + same call → the original result, `replayed: true`, no extra use consumed.

## `POST /capabilities/revoke`

Body `{ capabilityId, reason (1–500) }`, agent key. `200 {"result":"revoked"|"already_revoked"}`; `404
CAPABILITY_NOT_FOUND`; `409 CAPABILITY_ALREADY_USED` (a fully used capability cannot be revoked).
Administrators revoke from the dashboard (`revoke_capability()`, security_admin+).

## Health

- `GET /health` — liveness: `{"status":"ok"}`, touches nothing. Adds `"commit"` (a truncated, non-secret Render git SHA) when deployed on Render, so you can verify which commit is live.
- `GET /ready` — readiness: `200 {"status":"ready","github":…,"tls":…,"schema":"current"}` only if the gateway can reach its database
  with its credential and the database schema matches this build; otherwise `503 {"status":"not_ready","gateway":"not_configured|unreachable|tls_unverified"}`
  or `{"schema":"mismatch"}`. No host, role, version or error detail.

## Error envelope and rate limits

```json
{ "error": { "code": "UNAUTHENTICATED", "reason": "unauthenticated", "message": "…", "requestId": "uuid" } }
```

| code                      | HTTP |                                                                             |
| ------------------------- | ---- | --------------------------------------------------------------------------- |
| `UNAUTHENTICATED`         | 401  | missing, invalid **or revoked** key (deliberately identical)                |
| `RATE_LIMITED`            | 429  | ≥ 20 failed attempts for a key prefix in 60 s; sends `Retry-After: 60`      |
| `TASK_NOT_FOUND`          | 404  | also returned for another tenant's task                                     |
| `AGENT_TASK_MISMATCH`     | 403  | the key's agent is not the task's agent, or a session used for another task |
| `TASK_SESSION_REQUIRED`   | 403  | the application requires task sessions; a raw runtime key was used          |
| `ALIGNMENT_STATE_CHANGED` | 409  | objectives or context changed during review; retry the same request         |
| `IDEMPOTENCY_CONFLICT`    | 409  |                                                                             |
| `INVALID_REQUEST`         | 400  | field paths only, never values                                              |
| `PAYLOAD_TOO_LARGE`       | 413  |                                                                             |
| `GATEWAY_UNAVAILABLE`     | 503  | with `Retry-After: 5`; fails closed                                         |
| `INTERNAL_ERROR`          | 500  | generic                                                                     |

Failed authentication attempts are audited (`agent_auth_events`: only a 21-character key prefix, never the key).

## Part 7 endpoints

### `POST /api/v1/github/execute`

Bearer runtime key. Body (strict): `capability`, `tool`, `operation`, `resource` (`owner/repo`), `arguments`, `idempotencyKey`.
The agent supplies **no URL, method or path**. Responses:

- `200 { result: "succeeded" | "succeeded_noop", executionId, receiptId, execution: { mode: "mock"|"live", simulated }, resource, data }`
- `200 { replayed: true, status, receipt }` — the same idempotency key after the execution finished (result body is not stored).
- `4xx { error: { code }, executionId?, status: "released" | "failed" }` — `released` means nothing was sent and the use was returned.
- `504 { error: { code: "EXECUTION_INDETERMINATE" }, status: "indeterminate" }` — the write's outcome is unknown; **not retried**.
- `409 EXECUTION_IN_PROGRESS`, `403 REPOSITORY_NOT_BOUND|REPOSITORY_NOT_ALLOWED|INSTALLATION_UNAVAILABLE|SCOPE_MISMATCH`,
  `409 CAPABILITY_ALREADY_USED|CAPABILITY_REVOKED|CAPABILITY_EXPIRED|IDEMPOTENCY_CONFLICT`, `503 CONNECTOR_DISABLED|CONNECTOR_NOT_CONFIGURED`.

### `GET /api/v1/approvals/{id}`

Bearer runtime key (only the requesting agent's own approvals; others are `404`). `{ approvalId, state, requiredApprovals, approvals,
expiresAt, reason }`, state ∈ `pending | approved | rejected | expired | stale | consumed`. When `require_approval` is returned by
`/authorize`, the response includes `approval: { id, state, statusUrl, … }`. After `approved`, re-call `/authorize` with the same
idempotency key and arguments to receive the capability.

### GitHub App endpoints (browser / GitHub, not agents)

`POST /api/github/connect`, `GET /api/github/setup`, `GET /api/github/oauth/callback`, `POST /api/github/webhook`
(HMAC-SHA256 `X-Hub-Signature-256`, delivery-id de-duplication).

## Developer API: task lifecycle (backend credential)

Authenticated by a backend credential (`authority_dk_…`), never an agent key — see `/customers` and
`/customers/{customerId}/tasks` (OpenAPI only) for the rest of this group. See also `packages/authority-sdk`
for a typed client over all of it, and `examples/connector-quickstart` for a runnable end-to-end example.

### `POST /tasks/{taskId}/prepare`

Body: `{ plan }` (a structured `CandidatePlan`, same shape the dashboard's candidate-plan editor produces) or
`{ generate: true }` for an AI-drafted one, plus an optional `idempotencyKey`. Runs the same
validate → solve → compile → derive-approvals → verify pipeline the dashboard's "propose contract" action
runs, persists the result, then attempts automatic activation. Always `200` with a discriminated `status`:

- `ready` — activated automatically. `{ contractId, version, tools }`.
- `awaiting_approval` — proposed; one of the organization's approval rules matched, so a person approves it on the
  dashboard. `{ contractId, version, approvalPath }`.
- `alignment_review` — task alignment is enforced and the plan did not clear. `{ decision: "revise" | "hold",
contractId, version, reviewPath, alignment }`.
- `clarification` — the plan (structured or generated) could not be compiled as given. `{ reason, details? }`.
- `rejected` — the solver or verifier refused outright. `{ reason }`.
- `ai_unavailable` — `generate: true` was set but no model credentials are configured. Never a silent mock.

`ready` / `awaiting_approval` / `alignment_review` also carry `checks.planReview` (`ran` | `not_run`) and
`excludedSteps`: every submitted step that is not in the contract, with the validator's status and reasons. The
contract is compiled from the remaining steps, so a `ready` contract can lack a step you asked for.

**Closed-world arguments.** Each allowed action lists `openArguments`, the free-text fields its plan left unpinned
(shown per tool in `GET /tasks/{taskId}/tools`). `/authorize` refuses, with `CONSTRAINT_VIOLATION`, any argument
that the matched action neither pins nor lists there: an optional field the plan never set (another branch, a
mailbox query, an extra recipient field) cannot be added at call time. Contracts compiled before this rule have no
`openArguments` and keep the old behavior until re-prepared.

**Data flow is for free text only.** A step may fill an argument from an earlier step's output (`dataFlowRefs`)
only when the registry marks that argument as free text (message text, subject, title, description). Authority does
not verify where such a value came from and does not constrain it at runtime. A recipient, channel, id, path,
branch or amount must be a concrete value in `arguments`, which the compiler pins exactly; a data-flow reference to
one excludes the step with status `replan`.
A contract activates automatically unless an approval rule matched or enforced task alignment holds it;
neither ever widens what the compiler decided.

### Task alignment and content (see `docs/alignment/README.md`)

- `POST /tasks/{taskId}/content` — optional external-content screening: `{ content, contentType?, source }`.
  Backend key or the task's session. Returns `{ inspectionId, status, screening, findings, feedback, data }`;
  `status: "not_inspected"` (with `screening.ran: false`) when screening is off — never a pass.
- `GET /content/{inspectionId}` — status; held content is returned only after an administrator approved it.
- `POST /tasks/{taskId}/objectives` — backend key only: `{ request }` records a new objectives version.
- `/authorize` responses carry `checks.taskAlignment`; a stopped or held call returns `alignment` and
  `TASK_ALIGNMENT_MISALIGNED` / `TASK_ALIGNMENT_HELD` / `TASK_ALIGNMENT_UNREVIEWED`.
- `/execute` responses may carry `inspection` and `delivery: "held"` (the action ran; do not repeat it).

### `GET /contracts/{contractId}`

`{ contractId, taskId, status, tools, requiredApprovalsCount }`. Poll this on an `awaiting_approval` outcome
until `status` becomes `active` or `rejected`.

### Recovery guidance (`guidance`)

Every `/api/v1/authorize` response carries `guidance: { nextStep, message }` where `nextStep` is one of `proceed | replan |
clarify | request_approval | retry_later | stop`. It tells the agent how to recover from a refusal (replan with an authorized
operation, ask the user, wait for approval, or stop) without revealing thresholds, indicators or policy text. Guidance can only
advise seeking or waiting for more human-granted authority; it never grants any.
