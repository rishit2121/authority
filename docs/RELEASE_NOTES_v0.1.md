# Authority v0.1.0 — pilot release notes

> Historical (September 2026, private pilot). Superseded by [RELEASE_NOTES_v0.2.md](RELEASE_NOTES_v0.2.md); statements
> below about licensing, disclosure and limitations describe v0.1.0 only.

## What Authority does

Authority is a runtime authorization and least-privilege control plane for AI agents. An agent proposes a task; Authority
independently compiles the minimum authority that task needs into a contract, issues short-lived opaque capabilities for
each approved call, and enforces every request against that contract _inside the database_, not just in application code.
It also attacks its own controls in safe simulations (the Validation Lab), explains what fails, proposes fixes that can
only narrow authority, and turns accepted fixes into regression tests.

## What is real

- **Authentication and multi-tenancy**, backed by Supabase Auth and row-level security on every table.
- **The deterministic authorization engine**: plan validation, minimum-authority solving, contract compilation,
  argument-constraint enforcement (including numeric/boolean values, not just strings) — running as `SECURITY DEFINER`
  database functions behind a dedicated, least-privilege `authority_gateway` login that PostgREST never exposes.
- **The capability lifecycle**: opaque, hashed, single-purpose, short-lived tokens; two-phase reserve → dispatch → settle
  execution; idempotent replay; revocation.
- **The GitHub connector**, when configured in live mode: a fixed, typed route table (no raw URL/method/path an agent
  could control), default-branch write protection, a per-task branch namespace, webhook signature verification with a
  retry queue, and installation health/permission-drift detection with scheduled re-verification.
- **The Validation Lab**: 28 versioned attack scenarios executed against the _real_ gateway/compiler/capability/connector
  path in throwaway, database-enforced sandbox tenants; findings, narrowing-only remediation proposals, and regression
  tests generated from accepted fixes.
- **Operational hardening**: scheduled reconciliation (expired leases, sandbox cleanup, webhook retries, GitHub
  re-verification, data retention), a readiness endpoint that fails closed on schema mismatch or unverified TLS, and a
  pre-launch configuration checker.

## What remains simulated

- **Validation Lab campaigns** run entirely against synthetic tenants, an in-memory mock GitHub and an in-memory effects
  ledger. They measure what your controls contain against the scenarios in the library — not a production guarantee.
- **The semantic risk layer ships with a deterministic, rule-based mock provider by default.** It is real evidence
  alongside every decision, but it is not a trained model; a real provider is optional and, when configured, is still
  bounded by the same "can only narrow" composition rule as the mock.
- **GitHub in mock mode** (development/demo only; refused in production unless explicitly opted in) simulates the
  connector so the product can be explored with no real GitHub App.
- **The `/demo` walkthrough and the "install demo workspace" action** create real database rows in your own tenant but
  contact no external service.

## Security guarantees (see `docs/SECURITY.md` for the full threat model)

The database enforces authorization, not the application; row-level security isolates tenants; a semantic verdict can
only narrow a decision, never widen one; capabilities are opaque and single-use; the GitHub connector has no path to an
arbitrary URL; default-branch writes are refused; webhooks are authenticated before anything else happens; remediation
proposals can never broaden authority and nothing is applied automatically; sandbox campaigns cannot reach anything
real; retention never deletes append-only audit records; secrets are never logged, stored in plaintext, or echoed in an
error, and every browser bundle is scanned for them in CI.

## Explicit non-guarantees

Not a WAF or general rate limiter; not resilient to a compromised database superuser or a leaked gateway credential; the
semantic layer is advisory evidence, not a second enforcement engine; Validation Lab results are not a production
guarantee; the in-process maintenance scheduler only runs while the server is awake (use the external trigger on hosts
that sleep); no SOC 2, ISO 27001 or other compliance certification exists for this project.

## Required infrastructure

- A Supabase project with this repository's migrations applied, and the restricted `authority_gateway` login provisioned
  (`npm run gateway:provision`).
- Node 22 to run the server, CLI and CI.
- Optional: a GitHub App for live connector execution; a semantic provider API key for real-model risk evaluation; a
  scheduler (cron, GitHub Actions, or the built-in in-process timer) for maintenance.
- No paid service is required for the pilot path itself.

## Known limitations

- Validation Lab campaigns run inside the web server process; a long campaign is bounded by a time limit, and a
  mid-campaign restart is marked failed by the scheduled sweep rather than resumed.
- Scenarios are authored by the same team that built the controls; a clean starter-pack run shows the known attack
  library is contained, not that unseen attacks are.
- Human approver rules (role, self-approval, distinct approvers) are covered by database tests, not by Validation Lab
  scenarios.
- Custom, user-authored validation scenarios are not yet exposed in the UI (the engine supports stored definitions;
  regression scenarios use this path already).
- Retention automation covers only Validation Lab data and webhook/environment housekeeping rows; there is no automated
  export or deletion workflow for audit records.
- A transitive build-tool dependency (`postcss`, bundled inside `next@15.5.x`) has an advisory for arbitrary file read via
  a crafted `sourceMappingURL` comment; it runs only at build time against this repository's own trusted source, not
  against user-supplied CSS at runtime, and the only available fix is a major-version upgrade of Next.js, deferred past
  v0.1.
- No dedicated security disclosure process exists yet; see `docs/SECURITY.md`.
