# Capabilities

A capability is the only artifact that would unlock a tool execution. Part 6 issued, revoked and _simulated consuming_
them. **Part 7 adds real execution for GitHub tools through two-phase consumption** (reserve → dispatch → settle) — see
[../github/CONNECTOR.md](../github/CONNECTOR.md). Simulated consumption remains only for tools no connector runs, and refuses
connector tools (`CONNECTOR_EXECUTION_REQUIRED`).

## Opaque hashed tokens, not signed tokens

**Choice: opaque.** `authcap_v1_` + 43 base64url characters = 256 bits from a CSPRNG. Only its SHA-256 is stored
(`capability_tokens.token_hash`, unreadable by any client role at the column-privilege level).

Why not a signed (JWT/PASETO-style) token:

- Every property we need — revocation, single-use, invalidation when the contract/task/agent/key is revoked — is
  _database state a consumer must consult anyway_. A signed token would add key management, rotation and a revocation
  list while adding nothing an opaque token lacks.
- Nothing to forge: there is no structure or signature to attack, and a database read or backup yields no usable token.
- SHA-256 (not a slow KDF) is correct for a 256-bit random secret, as with agent keys.

`format_version = 1` on each row lets a future scheme (e.g. keyed hashing) coexist.

## What a capability is bound to

`tenant`, `agent`, `task`, issuing `credential`, `contract` id **and version**, the deterministic `authorization
decision` and the `final decision`, the exact `tool` and `operation`, the `resource` identifier, the applied
`resource_constraints`, `arguments_hash` (SHA-256 of the canonical arguments the decision was made for), `max_uses`,
`uses`, `issued_at`, `expires_at`, the `jti` (the row id) and `format_version`. The binding columns are immutable (a
trigger rejects any change); only `uses`/`status`/revocation fields move, and only forward.

## Lifecycle

```
final allow ──▶ issued (active) ──▶ consumed        (uses reached max_uses)
                       │        └─▶ revoked          (agent, admin, or system)
                       └──────────▶ expired          (derived: expires_at passed)
```

- **Issued only after a final allow.** A deny, a semantic narrowing, or a fail-closed degraded result never receives one
  (a CHECK ties tokens to final decisions; tests assert none exists for any non-allow).
- **TTL**: default 60 s, tenant-configurable 5–900 s, hard-capped at 15 minutes by a CHECK, and never beyond the
  contract's own `expires_at`.
- **Single-use by default.** A call may explicitly request `maxUses` 1–5; that many invocations are reserved from the
  contract budget at issuance, and the capability is consumed one use at a time.
- **Consumption is atomic**: a per-capability advisory lock, a re-read of `uses` under the lock, then one guarded
  update. Eight concurrent consumers of a single-use capability yield exactly one acceptance (integration-tested).
- **Idempotent**: `(capability, idempotency_key)` is unique. A retry with the same key and call replays the original
  result and consumes nothing; the same key with a different call is `IDEMPOTENCY_CONFLICT`.
- **Replay prevention**: a second consumption with a new key is `CAPABILITY_ALREADY_USED` and is recorded (the dashboard
  counts replay attempts). Rejected attempts are capped at 50/minute per capability so an attacker cannot flood the log.
- **Exact scope** on consumption: tool, operation, resource and the argument hash must equal what was issued, and the
  constraints are re-checked against the presented arguments. Nothing can authorize anything broader than the final
  decision.
- **Invalidated by its dependencies**, checked live on every consumption: the contract must still be the same active,
  unexpired version; the task must still be executable; the agent must be active; and the **issuing key** must still be
  active (so a capability cannot outlive the key that requested it, even if the same agent presents a newer key). When
  one of these fails the capability is revoked by `system` and the reason recorded.
- **Revocation**: by the owning agent (`POST /api/v1/capabilities/revoke`, idempotent) or a security admin from the
  dashboard (`revoke_capability()`); a fully used capability cannot be revoked; a revoked one is frozen.
- **Simulation only**: every `capability_consumptions` row has `simulated = true` by CHECK, and every response and the
  dashboard say so.

## Argument privacy

Raw arguments are evaluated in memory / inside the database transaction and dropped. `tool_requests` stores
`normalized_arguments = {"values":{}}` (a CHECK forbids values on a redacted row), a deterministic `request_hash` and
`arguments_hash`, and `argument_audit`: per argument the key, type, length, a 12-hex hash and — only for a small
allow-list of identifier-like keys whose values are short and match no secret/email pattern — the value. Pre-Part-6
rows are left as they were (no destructive rewrite); the dashboard marks them "pre-Part-6 record".

## Known limitations

- **A lost authorization response loses the token.** The plaintext exists only in the response that issued it; an
  idempotent retry returns the capability's id and expiry but never the token (`tokenAlreadyIssued: true`). The agent
  should revoke and re-request with a new idempotency key. (Deriving the token from a server secret would allow
  re-delivery at the cost of a new secret to protect; deliberately not done.)
- **An unused capability keeps its budget reserved** until the contract ends (a conservative choice; releasing on
  expiry is a Part 7 decision).
- `require_approval` finals (from semantic narrowing) are recorded but nothing yet turns an approval into a capability.

## Part 7 additions

- `capability_tokens.reserved_uses` (uses held by an in-flight reservation) and `budget_released_uses` (unused budget
  returned on expiry/revocation/disconnect). CHECK: `uses + reserved_uses + budget_released_uses <= max_uses`.
- `capability_reservations`: one row per (capability, idempotency key); states `reserved → consumed | released | failed |
indeterminate`; binding columns immutable; terminal states frozen (only an operator annotation of an indeterminate
  outcome may be added, once, and never changes the spent use).
- `capability_tokens.approval_request_id` links a capability minted after a human approval.
