# Security: threat model, guarantees and limitations

This is the top-level security reference for Authority. It summarizes the threat model and consolidates the security
properties and limitations documented in depth elsewhere (`docs/gateway/TRUST_MODEL.md`, `docs/gateway/CAPABILITIES.md`,
`docs/gateway/SECRETS.md`, `docs/validation/OVERVIEW.md`).

## Threat model

**In scope — Authority defends against:**

- A compromised or malicious agent (prompt injection, a hallucinated plan, a deliberately adversarial model) attempting
  to exceed the authority its task was granted: wrong tool, wrong resource, escalated arguments, unplanned calls,
  capability theft/replay, stale contracts/approvals, cross-tenant access.
- A caller that bypasses the application server entirely and hits the database or GitHub API directly.
- Forged or replayed webhooks, forged OAuth/install state, and a stale or already-used runtime credential.
- An operator error that would otherwise widen authority (validation remediation proposals, retention, revocation).

**Out of scope (by design, for v0.1):**

- A fully compromised customer database (a privileged attacker with `postgres` role access defeats any RLS-based
  design; standard Supabase/Postgres operational hardening is the customer's responsibility).
- Model-level attacks that never reach Authority (e.g. an agent that never calls `/api/v1/authorize` at all — Authority
  can only govern calls routed through it).
- General web application security of the customer's own front end or other services; Authority governs the
  authorization boundary, not the whole customer stack.
- Availability under sustained denial-of-service; there is no WAF or general rate limiter in front of the app (see
  "Non-guarantees" below).

## Core security guarantees

1. **The database, not the application, is the enforcement point.** `authority_gateway` is a dedicated, `NOLOGIN`,
   least-privilege Postgres role that owns no tables and can execute only `gateway.*` `SECURITY DEFINER` functions,
   which are not exposed by PostgREST. Every gateway function re-authenticates the presented runtime key itself; the
   gateway credential alone authorizes nothing. See `docs/gateway/TRUST_MODEL.md`.
2. **Row level security on every multi-tenant table.** Cross-tenant reads and writes are refused at the database layer,
   independent of anything the application code does. Verified by pgTAP suites 1–21 (every part) and by dedicated
   integration/e2e tenancy tests.
3. **Monotonic composition.** The deterministic engine decides first; a semantic verdict can only _narrow_ an allow
   (`deny` or `require_approval`), never grant or widen one. This composition rule is unconditional and covered by the
   full deterministic × semantic decision matrix in unit tests.
4. **Capabilities are opaque, single-purpose, short-lived tokens.** Only a SHA-256 hash is stored; a token is scoped to
   an exact tool/operation/resource/argument set, expires, and is consumed exactly once (idempotent replay returns the
   same result; a changed request is a conflict, not a reuse). See `docs/gateway/CAPABILITIES.md`.
5. **No raw URL, method or path ever reaches an external service.** The GitHub connector exposes a fixed, typed route
   table (`src/lib/github/routes.ts`); there is no code path that assembles a request from caller-supplied pieces, so
   there is no SSRF surface through the connector.
6. **Writes to a repository's default branch are refused** (`DEFAULT_BRANCH_WRITE_FORBIDDEN`); agent-created branches
   are confined to a deterministic per-task namespace.
7. **Webhooks are authenticated before anything else happens.** HMAC-SHA256 signature verification (constant-time
   compare) gates every code path, including the retry queue introduced in Part 8 — a failed, unsigned or forged
   delivery is never queued or applied.
8. **Remediation proposals can never broaden authority.** Checked in application code (`isNarrowingPatch`) and enforced
   independently by a database constraint (`proposal ->> 'broadensAuthority' = 'false'`); nothing is ever applied to a
   real contract, policy or registry automatically — a security admin (or above) must accept, and acceptance only
   triggers a sandboxed verification rerun.
9. **Validation Lab campaigns cannot reach anything real.** Every sandbox tenant is flagged, expiring, member-less, and
   every sandbox function refuses a tenant that is not a live sandbox (database-enforced, pgTAP suite 21). Effects go
   only to an in-memory mock GitHub and effects ledger.
10. **Retention never deletes audit evidence.** The retention purge (`gateway.retention_purge`) touches only Validation
    Lab campaigns, webhook delivery/retry housekeeping rows, and expired unused environments. `authorization_decisions`,
    `capability_consumptions`, `final_decisions`, `semantic_evaluations`, approval decisions and `agent_auth_events` are
    append-only and are never purged by any automated mechanism in v0.1.
11. **Secrets are never logged, stored in plaintext, or echoed in an error.** Runtime keys and capability tokens are
    shown once and stored only as a hash; the gateway credential and provider keys live only in server environment
    variables; error paths report an error _class_ or SQLSTATE, never a message or value. `npm run verify:bundle`
    scans every browser asset for gateway/driver/secret strings as part of CI.

## Explicit non-guarantees

- **Not a WAF or DDoS mitigation.** Runtime-credential authentication has a per-key-prefix rate limit (429 after 20
  failed attempts/60s); there is no general request-rate limiter. Put a platform-level limiter or CDN in front for that.
- **Not a guarantee against a compromised database superuser or leaked `GATEWAY_DATABASE_URL`.** Either defeats the
  model; rotate immediately with `npm run gateway:provision` if the gateway credential is suspected leaked.
- **The semantic layer is advisory evidence, not a second enforcement engine**, and in v0.1 ships with only a
  deterministic mock provider by default — it narrows decisions but the deterministic engine remains the sole security
  boundary. A real model provider is optional and, when configured, is still bounded by the same narrow-only rule.
- **Validation Lab results are not a production guarantee.** Scenarios are written by the team that wrote the controls,
  run against synthetic data, and a passing starter pack shows the _known_ attacks are contained — not that unknown
  attacks are. See `docs/validation/OVERVIEW.md` for the full limitations list.
- **The in-process maintenance scheduler only runs while the server process is awake.** On a host that sleeps when
  idle (e.g. Render's free plan), reconciliation pauses until either a request wakes it or the external
  `MAINTENANCE_TOKEN` trigger is called; see `docs/ops/OPERATIONS.md`.
- **No SOC 2, ISO 27001 or other third-party compliance certification exists for this project.** Nothing in the product
  or its marketing pages should be read as claiming one.

## Reporting

This is a pilot-stage project without a dedicated security contact yet; open a GitHub issue at
`rishit2121/authority-next` for anything that isn't sensitive, or reach the maintainer directly for anything that is.
