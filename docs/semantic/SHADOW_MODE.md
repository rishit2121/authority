# Semantic risk: shadow mode

## Modes

| Mode      | Status                | Behaviour                                                                                                                                                                                         |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`     | implemented (default) | No provider call, nothing recorded.                                                                                                                                                               |
| `shadow`  | implemented           | Evaluate after the deterministic decision, record, return a separately-labeled observation. Never affects the decision.                                                                           |
| `enforce` | **unavailable**       | Cannot be stored (a CHECK constraint on `semantic_settings`), refused by `set_semantic_settings()` (`0A000`), and resolves to "no semantic influence" in the runtime (`enforcement_unavailable`). |

## Why there is no enforcement

`authorize_tool_call()` is granted to `anon` and is callable directly with any valid agent runtime key. PostgreSQL
cannot prove that a semantic model ran, so any semantic verdict enforced outside the database can be bypassed by calling
the RPC directly. Claiming enforcement now would be false. Shadow evidence is therefore:

- **non-authoritative** — `authoritative = false` and `mode = 'shadow'` are CHECK constraints; the TS schema types
  `authoritative` as the literal `false`;
- **unattested** — `attestation = 'unattested'`. A holder of an agent key can record evidence for their _own_ decisions
  (the RPC checks tenant, agent and decision linkage, not that a model ran). Never treat a row as proof of evaluation;
- **append-only** — update/delete trigger, one row per decision (`unique (authorization_decision_id)`), so evidence
  cannot be re-rolled; replays return the original row.

## Data flow

1. `POST /api/v1/authorize` validates the request and calls `authorize_tool_call()` (deterministic, atomic). **This
   result is final and already persisted.**
2. `get_semantic_evaluation_context(secret, decision_id)` returns mode/provider/model/timeout plus the trusted task
   intent, the persisted tool call, allowed tools and up to five prior calls — all read from database rows scoped to the
   credential's tenant **and agent**. The caller supplies nothing to be evaluated.
3. Redaction (`src/lib/semantic/redaction.ts`): secret patterns (private keys, cloud/GitHub/Slack/Stripe/API keys, JWTs,
   bearer tokens, connection-string passwords, `password=…` values, Authority runtime keys), high-entropy blobs,
   email local parts, base64/hex segments are decoded and inlined (one level) so obfuscation is visible but any secret
   inside is removed; strings/keys/arguments/total bytes are capped.
4. Circuit breaker → provider call under a hard deadline → strict schema validation (`.strict()`: extra keys such as
   `decision`/`grantedTools` are rejected) → risk derived by our own code from the signals.
5. `record_semantic_shadow()` persists evidence: provider/model/version, state, signals, indicators, confidence,
   risk, latency, a SHA-256 of the _redacted_ payload, and redaction **counts**. The payload itself is never stored.
6. The response carries the deterministic decision unchanged plus `semantic: { authoritative: false,
affectedAuthorization: false, status, … }`.

Any failure in steps 2–5 becomes a `semantic.status` (`record_failed`, `disabled`, `enforcement_unavailable`, …) or a
degraded evidence state (`timeout`, `error`, `unavailable`, `circuit_open`, all with `signals = null` and
`riskLevel = unknown` — never neutral-looking numbers). It cannot change the deterministic record.

## Privacy and secrets

- Provider API key: server environment only (`SEMANTIC_PROVIDER_API_KEY`). No table holds a provider secret and no UI
  accepts one; the settings page shows only "configured / not configured". A UI-entered key would require Supabase Vault
  plus a privileged reader, which this project deliberately avoids (no service-role credential in the runtime path).
- Provider base URL is environment-only and must be https (a tenant-configurable URL would be an SSRF vector).
- Audit: `semantic_settings_audit` (append-only) records settings changes; evidence rows hold hashes and counts only.
- Known gap (pre-existing, Part 4): `tool_requests.normalized_arguments` stores the request arguments as sent.
  Semantic evaluation never sees them unredacted, but the request record itself is not redacted.

## Part 6 requirements before enforcement can be enabled

1. **Trusted gateway is the only path to authorization.** Revoke `anon` EXECUTE on `authorize_tool_call()`,
   `get_semantic_evaluation_context()` and `record_semantic_shadow()`; expose them only to a gateway service identity
   (service role or a dedicated DB role), never to agent keys. Agents talk only to the gateway.
2. **Attested evidence.** The gateway signs each semantic evaluation (HMAC/Ed25519 over decision id, provider, model,
   input hash, signals); the database verifies the signature (key in Vault or a verified DB role) so a row proves the
   gateway produced it. Drop `attestation = 'unattested'` only for signed rows.
3. **Atomic composition.** Deterministic decision and semantic verdict must be combined inside one trusted transaction
   or by a single component, so a semantic _narrowing_ (deny/require-approval) is applied before any budget is
   reserved and budget is restored or never consumed when semantic narrows. Semantic may only narrow: it must never turn
   a deny into an allow, add tools/resources, raise budgets, override hard-deny, activate contracts or issue
   capabilities.
4. **Fail-closed policy for enforcement.** Define behaviour on provider timeout/unavailability/circuit-open per risk
   tier (e.g. require approval for high-impact tools rather than allow).
5. **Provider credential handling.** Move the provider key to Vault (or the gateway's secret store) with rotation, and
   add a settings flow that writes it without ever reading it back.
6. **Calibration.** Measure on real labeled traffic (not this synthetic corpus), per tenant, before enabling any
   threshold; add shadow-vs-enforce canarying and an audit of every semantic narrowing.
7. **Redact `tool_requests`** arguments at rest (or hash sensitive fields) so the request log stops duplicating secrets.
8. **Shared circuit-breaker / metrics state** (e.g. a table or Redis) if enforcement latency matters across instances.
