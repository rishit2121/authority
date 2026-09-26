# Gateway trust model (Part 6)

## The problem Part 6 closes

Through Part 5, `authorize_tool_call()` and the semantic RPCs were granted to `anon`. Anyone holding the public
publishable key and one valid agent runtime key could call them straight over PostgREST, skip every check made in the
Next.js server, record "semantic evidence" the database could not attribute, and never trigger a required semantic
evaluation. PostgreSQL cannot prove that code outside itself ran, so the only sound fix is to make the Authority server
the only party _able_ to reach the database functions.

## Design: a dedicated, restricted database login

```
agent ──runtime key──▶ Authority API (Next.js) ──authority_gateway login──▶ gateway.* functions ──▶ tables
                       (authenticates, redacts,   (pooler, TLS)             (SECURITY DEFINER,
                        runs semantic provider)                              re-authenticate the key)
```

- **`authority_gateway`** is a Postgres role created `NOLOGIN` by migration (no credential is ever committed). Its
  password is set out-of-band by `npm run gateway:provision` (`scripts/provision-gateway-role.mjs`), which writes
  `GATEWAY_DATABASE_URL` into `.env.local`. It owns nothing, holds **no table privileges**, and can execute only
  functions in the `gateway` schema. Role-level limits: `statement_timeout 15s`, `idle_in_transaction_session_timeout
15s`, `connection limit 40`.
- The **`gateway` schema is not exposed by PostgREST** and neither `anon` nor `authenticated` has `USAGE` on it, so the
  anonymous key cannot even name a gateway function (`Content-Profile: gateway` returns 406).
- The legacy `public.authorize_tool_call`, `get_semantic_evaluation_context`, `record_semantic_shadow` and
  `record_agent_auth_failure` lost every grant (`anon`, `authenticated`, `service_role`, `PUBLIC`). PostgREST now answers
  `PGRST202` — the functions are invisible to the anonymous role. They remain only for the table owner so the pgTAP
  regression suites (17, 18) can pin the semantics the gateway evaluator was extracted from; nothing in the app calls
  them (a static test enforces it).
- Every gateway function **re-authenticates the agent runtime key itself** (SHA-256 lookup, rate limit, agent status),
  so the gateway credential alone authorizes nothing on behalf of an agent.
- All new tables (`final_decisions`, `semantic_evaluations`, `capability_tokens`, `capability_consumptions`) are
  read-only to members via RLS and writable only by these functions.

## Why not the alternatives

| Option                                                 | Verdict                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase service-role key** in a server module       | Works, but `service_role` bypasses RLS and can read/write every table. A leak is total compromise. It would also mean granting `service_role` access to many functions. Rejected: the blast radius is far larger than the task needs.                                                    |
| **HMAC/signature verified in the database**            | Needs a shared secret inside the database (Vault) plus per-call signing and replay handling, and still leaves the functions callable by `anon` with a stolen signature. More moving parts for a weaker boundary than "the role cannot be reached". Deferred as a defense-in-depth layer. |
| **Dedicated restricted role over the pooler** (chosen) | Smallest privilege that satisfies the requirement; no new managed service; works on Vercel-style serverless (transaction pooler, port 6543); the credential is one URL.                                                                                                                  |

## Blast radius of a leaked `GATEWAY_DATABASE_URL`

An attacker can call the gateway functions. They still need a valid agent runtime key to authorize anything, cannot read
or write any table directly, cannot read capability token hashes or any stored secret, cannot reach the legacy functions
and cannot touch other schemas. They _can_: submit calls for agents whose keys they hold; record semantic evidence for
those calls (the evidence is gateway-attested, so this is the residual trust in the gateway credential); and exhaust the
connection limit (bounded to 40). Rotate immediately (below).

## Where the credential lives and how it is kept out of the browser

- Read in exactly one file, `src/lib/gateway/db.ts` (`server-only`), which is also the only importer of `pg`. A unit test
  fails if any other file reads it or imports the driver, or if a client component imports anything from `lib/gateway`.
- `npm run verify:bundle` (run after `next build`, part of `npm run verify`) scans `.next/static` for the gateway
  identifiers, the `pg` driver, gateway function names and the **literal values** of every configured secret, and prints
  file paths and match labels only. It found nothing in this release.
- Errors from the module carry only a Postgres SQLSTATE; the URL, password, statement and parameters are never logged or
  returned. Logs go through `safeLog`, which scrubs known secret values, runtime keys, capability tokens and bearer
  material.

## Rotation procedure

1. `npm run gateway:provision` (needs the project owner's `postgres` password in `.supabase-cli.env`). This sets a new
   random password on `authority_gateway` — the old one stops working immediately — and rewrites `GATEWAY_DATABASE_URL`.
2. Deploy the new value to every environment that runs the API. Until then those instances fail `GET /api/v1/ready`
   (503) and authorization returns `GATEWAY_UNAVAILABLE`; they fail closed, never open.
3. For zero downtime, create a second role (`authority_gateway_b`), grant it the same privileges, cut over, then drop the
   old one. The provisioning script is intentionally single-role today.

## Deployment constraints and known gaps

- Use the **transaction pooler** (port 6543); the code uses only parameterized statements, no session state.
- **TLS**: the connection is encrypted; the certificate chain is verified only if `GATEWAY_DATABASE_CA` is set. Set it in
  production. Without it the code uses `rejectUnauthorized: false` (documented gap).
- One role serves every environment that shares this project. Production should get its own project/role, with the role
  limited by `pg_hba`/network policy where the platform allows.
- Future path: split into `authority_gateway_authorize` and `authority_gateway_admin` roles so the hot path holds no
  function that administers settings, and add signed attestations on semantic evidence (see Part 7 notes).
