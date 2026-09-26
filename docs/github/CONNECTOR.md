# GitHub connector (Part 7)

The first real Authority-controlled workflow: user task → candidate plan → minimum-authority contract → approval and
activation → agent asks for a GitHub operation → deterministic + semantic authorization → short-lived capability →
**reserve → dispatch → GitHub → settle** → immutable receipt and a full trace.

It is a **connector**, not a proxy. An agent never supplies a URL, HTTP method or API path. Each Authority tool maps to
fixed GitHub calls built server-side from validated parameters (`src/lib/github/routes.ts`).

## Supported operations

| Tool                           | GitHub calls (fixed)                                                     | Installation-token permissions          |
| ------------------------------ | ------------------------------------------------------------------------ | --------------------------------------- |
| `github.get_issue`             | `GET /repos/{o}/{r}/issues/{n}`                                          | issues:read, metadata:read              |
| `github.read_repository`       | `GET /repos/{o}/{r}`, optional `GET …/contents/{path}?ref=`              | contents:read, metadata:read            |
| `github.create_branch`         | `GET …/git/ref/heads/{b}` ×2, `POST …/git/refs`                          | contents:write, metadata:read           |
| `github.put_file`              | `GET …/branches/{b}`, `GET …/contents/{path}`, `PUT …/contents/{path}`   | contents:write, metadata:read           |
| `github.create_pull_request`   | `GET …/pulls?head&base`, `GET …/git/ref`, `POST …/pulls`                 | pull_requests:write, contents:read, metadata:read |
| `github.get_pull_request`      | `GET …/pulls/{n}`                                                        | pull_requests:read, metadata:read       |

Deliberately **not** supported and unreachable (no route exists): repository or Actions secrets, organization or
repository administration, webhook modification, arbitrary API paths or external URLs, repository/branch deletion, force
pushes, direct writes to the default or any protected branch, `.github/workflows`, `.git`.

## App permissions and events

Repository permissions: **Metadata: read, Contents: read & write, Issues: read, Pull requests: read & write.** Nothing
else. Any extra permission (or a missing one) on an installation is **drift**: the installation is set to
`permission_drift` and every execution is refused until fixed and re-verified. Webhook events: `installation` and
`installation_repositories` (GitHub delivers both to every App).

## Credential architecture

| Secret                                   | Where it lives                                             | Persisted in a table? |
| ---------------------------------------- | ---------------------------------------------------------- | --------------------- |
| App private key                          | server env `GITHUB_APP_PRIVATE_KEY` / `_BASE64` / `_FILE`  | never                 |
| Webhook secret, OAuth client secret      | server env                                                 | never                 |
| Installation access token                | process memory for one execution (`SecretToken`)           | never                 |
| User-to-server OAuth token               | process memory for one callback                            | never                 |

Persisted (ordinary tables, RLS): installation ids, account login, repository metadata, health, receipts.
A token is minted **per execution**, restricted to **one repository** and the **permissions that operation needs**
(table above). `SecretToken` refuses `JSON.stringify`, template interpolation and `util.inspect`; token- and key-shaped
text is redacted from anything returned; `verify:bundle` fails the build if any GitHub secret name or value reaches the
browser bundle.

## Two-phase capability consumption

```
available ──reserve──▶ reserved ──dispatch──▶ (GitHub) ──┬─ confirmed ─▶ consumed
                          │                              ├─ refused ───▶ failed        (use spent)
                          │                              └─ unknown ───▶ indeterminate (use spent, never retried)
                          └── definite pre-dispatch failure / lease expiry before dispatch ──▶ released (use refunded)
```

- **Reserve** is atomic under a per-capability advisory lock and creates a unique execution id plus a 45 s lease.
  Concurrent reservations for the last use cannot both win (8-way race test).
- Everything `consume` used to check is re-checked: token/agent/tenant/expiry, contract/task/agent/issuing-key
  liveness, exact tool/operation/resource, **argument hash** (arguments are re-supplied by the agent and hashed; no
  arguments are stored), constraints — plus the GitHub context: repository allowlisted, task bound, installation
  `active`, execution mode matches the installation.
- **Dispatch** re-checks revocation immediately before the request and sets `dispatched_at` exactly once (a second call
  can never dispatch again).
- Only the reserving execution (its id **and** agent) can settle it. `consumed` is written only after a confirmed result.
- **Leases** reconcile lazily (on every reserve, and via `gateway.reconcile_expired_reservations`): an expired
  undispatched lease is released; an expired _dispatched_ lease is `indeterminate`.
- Simulated `consume` refuses connector tools (`CONNECTOR_EXECUTION_REQUIRED`), so a simulation can never spend a
  capability a connector could use.
- **Budget**: unused uses of an expired or revoked capability are returned to the contract budget exactly once
  (`capability_tokens.budget_released_uses`), also on disconnect. Historical rows are never rewritten.

## Egress and SSRF protections

Fixed origin `https://api.github.com`; per-request 8 s timeout and 25 s whole-operation deadline; 1 MiB response cap
enforced while streaming; **redirects are never followed** (a 3xx is a definite refusal); the credential is attached in
one place and only for the route's declared auth kind; route parameters are individually encoded and re-verified
(`.`, `..`, `%`, `\`, `?`, `#`, `:` and empty segments are rejected); only declared query parameters are accepted.
Owner/name must match the installation-bound repository; branch names must live under `authority/<task8>/…`; the default
branch, protected branches and workflow files are unwritable; file paths reject traversal and any percent-encoding.

## Idempotency and ambiguity

Deterministic namespaces and **check-before-create**: an existing branch at the expected base is a `succeeded_noop`;
`base_sha`/`expected_sha` are compared before any write; identical file content is a no-op; an open PR for the same
head/base is returned instead of creating another. A 422 after a write is resolved by re-reading, never assumed.
A timeout, lost connection or 5xx **on a write** is `indeterminate`: the use is spent, the key replays that state, and
nothing is auto-retried. An operator can annotate the outcome (`executed` / `not_executed`); the use stays spent. A
fresh capability then finds the resource already there (check-before-create) and succeeds without a second write.

## Receipts

`github_execution_receipts`: compact, append-only (trigger), tenant-isolated (RLS). Fields: execution id, tenant/task/
agent, capability and decision, installation and repository, tool/operation, request hash, execution mode
(`mock`|`live`), result category, GitHub request id, HTTP status class, created-resource identifiers (branch, path,
PR number/URL, commit sha), before/after SHA, start/end timestamps, redaction counts, failure/indeterminate reason.
No response bodies, issue text, file contents or tokens are stored. Receipts are evidence, not authority.

## Approval → capability

A `require_approval` final decision (semantic high risk, a tenant **policy class**, or a registry requirement) persists a
`runtime_approval_requests` row bound to the exact request: task, contract id+version, tool, resource, arguments hash and
the deterministic/semantic evidence, plus a **context hash** (contract, task/agent state, semantic + approval policy,
integration permissions and repository allowlist). Approvers (security admin+) decide in `/app/approvals`:

- the task's principal, its initiating user and the agent's owner **cannot approve** (any principal the _user_ holds
  counts); a high-risk request needs **two distinct people**;
- a changed context makes it `stale` at decision time and again at mint time;
- **approval mints nothing.** The agent re-calls `POST /api/v1/authorize` with the same idempotency key and arguments;
  the gateway re-evaluates the deterministic decision (it must still allow), the contract version, agent and key
  liveness, the context hash and the budget, then mints. Rejection, expiry (1 h) and staleness never mint.

## Mock vs live

`GITHUB_EXECUTION_MODE=disabled` (default) | `mock` | `live`. Mock uses an in-memory GitHub (`src/lib/github/mock.ts`) and
is refused in production unless `AUTHORITY_ALLOW_MOCK_GITHUB=1`. Installations and reservations carry their mode; a live
execution against a mock installation (or vice versa) is refused, and every screen labels **MOCK (simulated GitHub)** or
**LIVE GitHub**.

## Where things are

- Schema/RPCs: `supabase/migrations/20260930000001…09_*.sql`; pgTAP `supabase/tests/20_github_connector.sql`.
- Connector: `src/lib/github/*`; gateway wrappers `src/lib/gateway/rpc-github.ts`; routes `src/app/api/v1/github/execute`,
  `src/app/api/v1/approvals/[id]`, `src/app/api/github/{connect,setup,oauth/callback,webhook}`.
- UI: `/app/integrations/github`, task page GitHub panel, `/app/approvals`.
