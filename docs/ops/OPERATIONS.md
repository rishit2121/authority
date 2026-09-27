# Operations

## Health and readiness

- `GET /api/v1/health` liveness (touches nothing) — `{"status":"ok","commit":"<short sha>"}` on Render, so a deploy can be checked against the commit that was supposed to ship. Use as the platform health check.
- `GET /api/v1/ready` readiness. `200 {"status":"ready","github":"disabled|mock|live","tls":"verified","schema":"current"}` only when
  the gateway reaches its database with its own login, the certificate chain is verified (production), the database
  schema is the version this build expects (`gateway.schema_version()`), and a live GitHub connector is fully configured.
  Otherwise `503` with a coarse reason: `not_configured | tls_unverified | unreachable | schema: mismatch | github: misconfigured`.
  No host, role or error detail is ever returned. **A `schema: mismatch` means run `npx supabase db push` before routing traffic.**
- `npm run check:production [-- --url https://...]` checks your deployment's environment before go-live (no secret values
  are printed) and optionally probes the live URL.

## Scheduled reconciliation

`runMaintenance()` (`src/lib/maintenance`) is idempotent, bounded, and isolates failures per step:

1. expired capability reservation leases: never-dispatched -> released (use returned); dispatched -> `indeterminate` (never retried);
2. validation sandboxes past expiry destroyed; campaigns stuck running > 30 min marked failed; environments marked expired;
3. queued **webhook retries** applied (below);
4. **GitHub installation re-verification** (live mode only): installations not verified in the last hour are re-read from GitHub;
   permission drift, suspension or removal flips them to a non-usable state so capabilities stop being issued;
5. **retention purge** (below).

It runs in-process every 5 minutes in production (`MAINTENANCE_INTERVAL_SECONDS`, 60-3600; `AUTHORITY_SCHEDULER=off` disables it)
and on demand: `POST /api/internal/maintenance` with `Authorization: Bearer $MAINTENANCE_TOKEN` (the endpoint does not exist
unless the token is set, 24+ characters). Use the external trigger on Render's free plan, which sleeps when idle: a scheduled
call (`.github/workflows/maintenance.yml`) both wakes the service and runs the work. The last run is shown under Settings.

Expiry never depends on the scheduler for **safety**: a capability past `expiresAt` or a revoked contract is refused at use time
regardless. The scheduler releases held budget and cleans up.

## Webhooks

GitHub does not retry failed deliveries. Authority verifies the HMAC signature, de-duplicates by delivery id, and if applying a
genuine delivery fails (e.g. database down) it stores it in `github_webhook_retries` and answers `202 queued_for_retry`. The
maintenance job retries with exponential backoff (1, 2, 4 ... 60 min) and gives up after 8 attempts (`dead`; visible in the
table and redeliverable from the GitHub App's delivery log). Application is idempotent, so a duplicate can never apply twice.

## Rate limits

Runtime credentials: after 20 failed authentication attempts within 60 seconds from one key prefix, further attempts get `429
RATE_LIMITED` with `Retry-After: 60`. Successful calls are not throttled by this. Settings shows the last 24 hours of auth
outcomes (security admins and above). There is no general request-rate limit in the MVP; put your platform's own limiter in front for that.

## Retention

Settings -> Retention (admins and owners): how long Validation Lab campaigns are kept (7-365 days, default 30). The purge also
removes webhook delivery ids older than 90 days, finished retry rows older than 14 days, and expired unused environments.
**Decisions, approvals, receipts and authentication events are append-only audit records and are never purged.** Automatic
deletion or export of those is not offered in the MVP.

## Runbook notes

- Rotate the gateway login: `npm run gateway:provision`, then update `GATEWAY_DATABASE_URL` everywhere it is deployed.
- Kill switch: revoke the contract or the agent key from the dashboard; capabilities already issued are refused at use time.
- Stuck `indeterminate` executions are not retried automatically: a human inspects the receipt and resolves it.
