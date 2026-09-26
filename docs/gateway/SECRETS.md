# Secret handling

| Secret                                         | Lives in                                                                                                 | Never in                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Agent runtime keys (`authority_rk_…`)          | shown once at issue; SHA-256 stored                                                                      | any log, response, or table       |
| Capability tokens (`authcap_v1_…`)             | returned once in the authorize response; SHA-256 stored                                                  | any log, table, or later response |
| Gateway DB credential (`GATEWAY_DATABASE_URL`) | server environment, `.env.local` locally                                                                 | git, browser bundle, logs, errors |
| Semantic provider key(s)                       | server environment (`SEMANTIC_PROVIDER_API_KEY[_SECONDARY]`)                                             | any table, UI, API response, log  |
| Supabase project keys                          | publishable key is public by design; DB password / access token stay in `.supabase-cli.env` (gitignored) | the app runtime                   |

## Provider credentials

There is no application table for provider secrets and no UI that accepts one; the settings page shows only whether the
server has a key ("configured"/"not configured", and whether a rotation key is present). Provider _health_ (success,
timeout, error, unavailable and circuit-open counts, p50/p95 latency) is computed from persisted evidence and shows
nothing secret. The product runs fully in deterministic/shadow mode with no key at all.

**Rotation (zero downtime):** set `SEMANTIC_PROVIDER_API_KEY_SECONDARY` to the new key and deploy; the provider tries the
primary and falls through to the secondary only on 401/403. Then promote the new key to `SEMANTIC_PROVIDER_API_KEY`,
remove the secondary, and revoke the old key at the provider. A non-auth failure (timeout, 5xx) never triggers the
fallback.

**A UI-entered key** would need Supabase Vault plus a privileged reader; that needs a second trusted credential and is
deferred (Part 7 will need Vault for integration credentials anyway — do both together).

## Logging rules

- Handlers log the error _class name_ only; messages and causes can carry request content.
- The gateway DB module logs only a SQLSTATE.
- `safeLog` scrubs the literal value of every configured secret (and the password inside the DB URL), runtime keys,
  capability tokens and `Bearer …` material before writing.
- Validation errors name field paths, never values.
- Postgres does not log bound parameters on error by default (`log_parameter_max_length_on_error = 0`); do not raise it.

Tests: `secrets.test.ts` forces every provider/DB failure mode and asserts no secret appears in evidence, errors or
captured log output; `routes.test.ts` asserts a secret-bearing exception never reaches a response or log; the bundle
scan asserts no secret value ships to the browser.
