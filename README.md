# Authority

**Agents receive authority for the task, not access to the account.**

Authority is a runtime authorization and least-privilege control plane for AI
agents. Companies are giving agents access to GitHub, databases, email,
Slack, CRMs, payment systems and cloud infrastructure — usually with broad,
standing credentials that grant far more authority than any one task needs.
Authority changes that model: the customer keeps ownership of its agent,
model, planner and execution plan; Authority independently decides whether
each proposed action is justified by the user's task and organization
policy, issues the smallest temporary capability that satisfies it, and
enforces that capability before credentials ever reach the external service.

## MVP status — Part 2A

Part 1 built the frontend and the authorization domain. **Part 2A adds real
authentication and tenant membership.** What that means precisely:

**Real as of Part 2A**

- Sign-up, sign-in, sign-out, password-reset request and password-reset
  completion, against Supabase Auth.
- Profiles, tenants and tenant memberships in Postgres, with row level
  security and SQL migrations committed to this repository.
- `/app/*` is protected on the server. The signed-in user, their workspace
  and their role in the sidebar are real, and the workspace selector reads
  actual memberships.

**Still mocked**

- **Every product record.** Tasks, agents, contracts, decisions,
  capabilities, events, policies, integrations and approvals all come from
  fixtures in `src/lib/mock/`, scoped to a demo tenant that is unrelated to
  the workspace you are signed into. The dashboard says so on screen.
- **There is no enforcement.** The deterministic evaluator in
  `src/lib/authorization/evaluate.ts` is real, tested logic, but nothing in
  this build sits in front of an actual GitHub, Stripe or Slack API. No
  credential is ever issued, held or used.
- **No semantic provider.** `MockSemanticDecisionProvider` is a local
  heuristic. No call is made to Jev or any other service.

Part 2B replaces the mocked product data with Supabase-backed
`AuthorityRepositories`. See [Part 2B scope](#part-2b-scope).

## Validation Lab and launch hardening (Part 8)

Authority now also **attacks its own controls in safe simulations**: 28 versioned attack scenarios (prompt injection, secret
exfiltration, recipient/repository/resource substitution, amount escalation, capability theft/replay/races, stale contracts and
approvals, semantic-provider faults, schema drift, obfuscation, benign false-positive controls) run against the real
authorization gateway in throwaway sandbox tenants with mock integrations. Failures become findings with narrowing-only
remediation proposals; accepting one pins a regression test and reruns the attack with the fix. Everything is synthetic and
labeled as such.

- Start here: [`docs/QUICKSTART.md`](docs/QUICKSTART.md) (ten minutes) and [`docs/validation/OVERVIEW.md`](docs/validation/OVERVIEW.md)
- Scenario catalog: [`docs/validation/SCENARIOS.md`](docs/validation/SCENARIOS.md) (generated: `npm run docs:scenarios`)
- CLI and CI gate: [`docs/validation/CI.md`](docs/validation/CI.md) (`npm run -s validate -- --pack starter`)
- Operations, maintenance, retention, health: [`docs/ops/OPERATIONS.md`](docs/ops/OPERATIONS.md); production check: `npm run check:production`
- Agent integration example: [`examples/agent/`](examples/agent)

## Architecture overview

```
src/
  middleware.ts            Session refresh + route gate (Next 15 convention)
  app/
    (marketing)/          /  and  /demo         — public marketing layout + pages
    (auth)/               /login, /signup, /forgot-password, /reset-password
    auth/                 /auth/callback, /auth/sign-out — route handlers
    app/                  /app and its children  — control-plane dashboard
  components/
    marketing/             Landing page sections, header, footer
    auth/                  Auth shell, form fields, form status banners
    graph/                 The agent-centred radial authority graph
    demo/                  The /demo guided walkthrough
    dashboard/              Sidebar, shell, metric cards, task table
    task/                  The task investigation view and its panels
    ui/                    Shared primitives (Icon, Section, DecisionStatusBadge, …)
  lib/
    domain/                Zod schemas, inferred types, repository interfaces
    authorization/         The deterministic evaluator + semantic decision port
    auth/                  Identity, tenant context, safe redirects, error mapping
    supabase/              Browser / server / middleware clients + generated types
    env.ts                 Runtime environment validation
    mock/                  In-memory repositories and fixture data
    data/                  Loaders: page → loader → repository seam
  hooks/                   useReducedMotion, useSidebarCollapsed, useFocusTrap
  styles/                  globals.css
  tests/
    unit/                  Vitest + Testing Library
    e2e/                   Playwright
supabase/
  config.toml
  migrations/              Committed SQL — the only way schema changes happen
  seed.sql                 Development fixture users and tenants
  tests/                   pgTAP suites for RLS, escalation and onboarding
scripts/
  db-test.mjs              Runs supabase/tests against the linked project
```

Domain logic is deliberately kept out of `components/`. A page calls a
loader in `lib/data/`; a loader reads through the `AuthorityRepositories`
interface in `lib/domain/repositories.ts`; today that interface is bound to
an in-memory implementation in `lib/mock/`. Components receive plain props
and import no fixtures, so swapping the in-memory repositories for a real
database does not require touching a component.

Authentication and tenancy do not go through `AuthorityRepositories`. They
have their own data layer in `lib/auth/`, described below, because a profile
and a tenant membership are not domain entities of the authorization model —
conflating them with `Principal` would blur the trust boundary the domain
exists to express.

## Routes

| Route                                                                                  | What it is                                                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                                    | Marketing landing page. The hero contains the animated authority graph.                                               |
| `/demo`                                                                                | A nine-step guided walkthrough of one authorization pass, built on the GitHub #991 scenario.                          |
| `/app`                                                                                 | The control-plane dashboard: sidebar, overview metrics, recent task traces.                                           |
| `/app/tasks`                                                                           | All mocked tasks for the tenant.                                                                                      |
| `/app/tasks/demo-task`                                                                 | The full investigation view for the GitHub #991 task: contract, plan, decisions, capabilities, timeline, kill switch. |
| `/app/agents`, `/app/policies`, `/app/integrations`, `/app/approvals`, `/app/settings` | Present in navigation; each states plainly that it is not implemented in this build.                                  |
| `/login`, `/signup`                                                                    | Email and password sign-in and sign-up. An authenticated visitor is redirected to `/app`.                             |
| `/forgot-password`, `/reset-password`                                                  | Request a reset link, and complete the reset from the emailed link.                                                   |
| `/auth/callback`                                                                       | Exchanges an email link's code for a session, then forwards to a validated internal path.                             |
| `/auth/sign-out`                                                                       | POST only. Ends the session and clears the workspace cookie.                                                          |

Every `/app/*` route is server-rendered on demand and protected. The
marketing and auth routes are public.

## Domain layer

`src/lib/domain/` defines Zod schemas (with inferred TypeScript types, no
`any` anywhere) for every entity in the trust model:

`Tenant`, `Principal`, `Agent`, `Task`, `TaskAuthorityContract`, `Plan` /
`PlanNode`, `ToolRequest`, `AuthorizationDecision`, `Capability`, `Approval`,
`ExecutionEvent`, plus the provider-neutral `SemanticDecisionInput` /
`SemanticDecisionResult`.

A few invariants are enforced structurally, not by convention:

- Every schema is `.strict()` — an unrecognized field fails validation
  rather than passing through silently.
- `Capability.expiresAt` is **required**. Standing access has no
  representation in this schema; a capability without an expiry cannot be
  constructed.
- A `ResourceConstraint` must carry exactly one of `equals` or `matches` —
  never both, never neither.
- `AuthorizationDecision.status` is one of exactly six values: `allow`,
  `allow_constrained`, `replan`, `clarify`, `require_approval`, `deny`.

`src/lib/domain/repositories.ts` defines one interface per entity
(`TaskRepository`, `CapabilityRepository`, …) plus `AuthorityRepositories`,
which aggregates all of them into the single seam every page depends on.
These remain interfaces bound only to in-memory fixtures — Part 2A did not
implement a Supabase-backed version of any of them, and did not change their
shape to accommodate one. The Supabase code added in Part 2A lives in
`lib/auth/` and `lib/supabase/` and deals exclusively with authentication and
tenancy.

## The deterministic authorization flow

`evaluateToolRequest` (`src/lib/authorization/evaluate.ts`) decides whether
one proposed tool call is authorized under its Task Authority Contract. The
order of checks is fixed and load-bearing:

1. **Hard-deny policy** — a forbidden-resource glob match. Checked first,
   never reconsidered, never overridable by anything downstream.
2. **Contract membership** — is the tool one of the contract's allowed
   actions at all?
3. **Constraint matching** — do the arguments satisfy every constraint on
   that action (e.g. `branch matches fix-*`)?
4. **Invocation budget** — has the task exhausted its ephemeral limit?
5. **Semantic evidence** — advisory signal from a `SemanticDecisionProvider`,
   consulted last and **only able to narrow** the outcome (e.g. from `allow`
   to `require_approval`), never to widen it.

A hard deny at step 1 returns before a semantic provider is ever consulted —
a forbidden request is refused on policy alone, with no model in the loop at
all.

### The semantic decision provider — and where Jev fits

`SemanticDecisionProvider` (`src/lib/authorization/semantic-decision-provider.ts`)
is a narrow, provider-neutral port:

```ts
interface SemanticDecisionProvider {
  readonly name: string;
  evaluate(input: SemanticDecisionInput, options?: { timeoutMs?: number }): Promise<SemanticDecisionResult>;
}
```

**Jev** is the production implementation this port is built for. Jev will be
a fast runtime semantic evaluator returning structured probability evidence
across six dimensions — task-to-action alignment, resource relevance, scope
expansion, external disclosure, plan consistency and aggregate semantic
risk — each carried on `SemanticDecisionResult` alongside provider, model,
model version, confidence, latency and an explicit `ok | timeout | error`
state.

Jev's role is bounded on purpose. A semantic provider — Jev or any other —
**cannot**:

- hold or reach credentials,
- mint or extend a capability,
- override a hard-deny policy rule,
- widen a Task Authority Contract, or
- independently approve a high-risk operation.

It supplies evidence; `evaluate.ts` is the only place a decision is made.

On provider timeout or error, `hasUsableEvidence` treats anything other than
`state: "ok"` as no evidence at all, and **the deterministic result stands**.
Concretely: a degraded provider can never turn a deny into an allow, but a
request the deterministic rules already permit is still permitted. There is
no notion of a "high-risk, semantic-required" action in this build — marking
certain actions as requiring live semantic evidence, and failing them closed
when the provider is unavailable, is a later part. What is exercised in
`src/tests/unit/authorization-evaluate.test.ts` today is that degraded
evidence is discarded rather than trusted.

Because the port never names a vendor, **Laya or another provider** can be
substituted later by writing one more implementation of
`SemanticDecisionProvider` — nothing in `evaluate.ts` or the rest of the
authorization domain depends on Jev specifically. Part 1 ships only
`MockSemanticDecisionProvider`, a deterministic local heuristic with no
network calls and no API key.

## The authority graph

`src/components/graph/` renders the hero's agent-centred radial graph as
real SVG/React — not an image. All geometry and copy live in
`graph-data.ts`. One enforcement cycle loops: all four capabilities
(`postgres.query_order`, `stripe.retrieve_payment`, `stripe.create_refund`,
`gmail.send_email`) are granted **simultaneously**, each takes a turn in a
spotlight (rendered on top via a duplicate overlay path), the out-of-scope
Slack call is shown with a muted rose tint and fades out having never been
granted, successful paths flash before retracting, and the ledger ends at
"4 capabilities revoked · 0 standing permissions." The cycle pauses on
pointer or keyboard focus and resumes only via explicit Pause/Resume or
Replay — it never advances while someone is inspecting it.

Motion is CSS/SVG only (`stroke-dashoffset` transitions), not Framer Motion.
Framer Motion is used for step transitions in the `/demo` walkthrough
instead, and both respect `prefers-reduced-motion`: the graph renders a
static resolved end-state with zero timers, and `MotionConfig
reducedMotion="user"` defers the walkthrough's transitions to the OS
setting.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the two NEXT_PUBLIC_SUPABASE_* values
npm run dev                  # http://localhost:3000
```

The marketing routes work without Supabase configured. `/app` and the auth
routes need `.env.local`; without it they report which variables are missing
rather than failing obscurely.

| Script                            | What it does                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Dev server on port 3000                                                                         |
| `npm run build`                   | Production build                                                                                |
| `npm start`                       | Serve the production build                                                                      |
| `npm run lint`                    | ESLint (flat config, `next/core-web-vitals` + `next/typescript`, `no-explicit-any` as an error) |
| `npm run typecheck`               | `tsc --noEmit`                                                                                  |
| `npm run format` / `format:check` | Prettier                                                                                        |
| `npm run test`                    | Vitest unit tests (`src/tests/unit/`)                                                           |
| `npm run test:watch`              | Vitest in watch mode                                                                            |
| `npm run test:e2e`                | Playwright end-to-end tests (`src/tests/e2e/`) — builds and serves production on port 3100      |
| `npm run db:test`                 | pgTAP suites against the linked Supabase project (`supabase/tests/`)                            |
| `npm run db:push`                 | Apply `supabase/migrations/` to the linked project                                              |
| `npm run db:types`                | Regenerate `src/lib/supabase/database.types.ts`                                                 |
| `npm run verify`                  | format:check → lint → typecheck → test → build, in order                                        |

First-time Playwright setup needs the browser binary once:

```bash
npx playwright install chromium
```

## Carried over from Part 1

The Part 1 suites are unchanged in intent, with two adjustments forced by
server-side protection: the dashboard, kill-switch and accessibility specs now
run in Playwright's `authenticated` project, and the marketing walkthrough
signs in before following its hand-off link into `/app`. Assertions are still
on content and state, never on animation timing or pixel coordinates —
zero horizontal overflow and zero console errors at 1440px, 834px and 390px,
keyboard operability, visible focus, and `prefers-reduced-motion` rendering.

See [Tests](#tests) for the full current picture.

## Authentication and tenancy (Part 2A)

### Supabase architecture

Three clients, one per execution context, all holding only the publishable
key:

| File                         | Used by                                    |
| ---------------------------- | ------------------------------------------ |
| `lib/supabase/client.ts`     | Client Components (`createBrowserClient`)  |
| `lib/supabase/server.ts`     | Server Components, Actions, Route Handlers |
| `lib/supabase/middleware.ts` | The session-refresh boundary               |

There is **no service-role client anywhere in this codebase**. No code path
can bypass row level security, and no secret key is reachable from the
browser.

`src/middleware.ts` is the refresh boundary. Next.js 15 names this entry
point `middleware.ts`; Next 16 renamed the file to `proxy.ts` with an
exported `proxy` function. This project is on **Next 15.5.25**, so the 15
convention applies. The deprecated `@supabase/auth-helpers` packages are not
installed and are not used.

### Verification: `getClaims` and `getUser`

Both are used, deliberately, in different places:

- **Middleware uses `getClaims()`** on every matched request. It verifies the
  token — locally against the project's JWKS when asymmetric signing keys are
  enabled — and performs the refresh as a side effect. This is the cheap gate.
- **The protected layout uses `getUser()`** before loading any tenant data.
  It asks the Auth server, so a revoked, banned or deleted user is rejected
  immediately.

The reason for the split is that local verification means a
cryptographically valid token outlives its session by up to the token
lifetime (an hour by default). For a product whose thesis is that authority
is revocable, an hour of stale access on the protected path is the wrong
trade. `getSession()` is never used in server code.

### Route protection

`/app/*` is protected in two places, and the redundancy is intentional.
Middleware redirects an unauthenticated request to `/login` before anything
renders. `requireIdentity()` in `src/app/app/layout.tsx` then re-verifies the
user server-side, because a middleware matcher is a pattern and patterns have
edges. There is no client-side route guard anywhere.

Every redirect target passes through `safeReturnPath`
(`lib/auth/redirect.ts`), an allowlist that rejects rather than sanitizes.
It refuses absolute URLs, protocol-relative `//host` and `/\host` forms,
their percent-encoded variants in either case, control characters and their
encodings, anything carrying a scheme, and auth routes as destinations.
A rejected candidate falls back to `/app`; it is never repaired into shape.

### Database schema

Three tables, created by the migrations in `supabase/migrations/`:

- **`profiles`** — `user_id` (PK → `auth.users`), `display_name`,
  `avatar_url`, timestamps.
- **`tenants`** — `id`, `name`, unique `slug`, `environment`, `created_by`,
  timestamps.
- **`tenant_memberships`** — `(tenant_id, user_id)` composite primary key,
  `role`, timestamps.

`tenant_role` is a Postgres enum (`viewer`, `developer`, `security_admin`,
`admin`, `owner`), so an unknown role cannot be written at all. Authority
ordering is defined explicitly by `authz.role_rank()` rather than inherited
from enum declaration order, so adding a role later cannot silently change
who outranks whom.

These tables model **authenticated application users**. They are not the
domain's `Principal`, which represents the delegated human or service
authority a task acts under. A `Principal` may later reference a `user_id`;
the two are not the same thing.

### Row level security

RLS is enabled on all three tables with nine policies, every one scoped to
the `authenticated` role. There is no `using (true)` anywhere. `anon` holds
no table privileges at all, so unauthenticated access fails on privileges
before RLS is even consulted.

| Table                | Read                              | Write                                           |
| -------------------- | --------------------------------- | ----------------------------------------------- |
| `profiles`           | own row only                      | insert/update own row; no delete                |
| `tenants`            | tenants you hold a membership in  | update by admin and above; no insert, no delete |
| `tenant_memberships` | all members of accessible tenants | insert/update/delete by admin and above         |

Two details worth knowing before you read the policies:

**Why `SECURITY DEFINER` helpers exist.** The natural policy for `tenants` is
"readable when I hold a membership", which reads `tenant_memberships`. The
natural policy for `tenant_memberships` is the same condition, which is
self-referential — Postgres aborts with infinite recursion. The helpers in
the private `authz` schema break the cycle by not being subject to that
table's RLS. Each one pins `search_path = ''` and uses fully-qualified names
so no user-created object can be resolved in its place, takes typed
arguments with no dynamic SQL, reads only rows belonging to `auth.uid()`, and
has `EXECUTE` revoked from `public` and `anon` before being granted to
`authenticated`.

**Why `FORCE ROW LEVEL SECURITY` is not used.** Forcing RLS would apply
policies to the table owner too, which is exactly the exemption the
recursion-breaking helpers depend on. Containment comes from those functions
being narrow and execute-revoked instead.

**How escalation is blocked.** Membership writes require
`user_id <> auth.uid()`, so no role can edit its own membership row — that
alone stops self-promotion. `USING` evaluates the old role and `WITH CHECK`
the new one, and an admin's ceiling is admin, so an admin can neither create,
promote, demote nor delete an owner. Two guard triggers add defence in depth
for privileged paths: a tenant must retain at least one owner, and membership
identity (`tenant_id`, `user_id`) is immutable.

One consequence is worth stating because it bit during development: the
memberships read policy deliberately exposes **co-members** of a tenant, so
member administration can work. Application queries for "my workspaces"
must therefore filter by `user_id` themselves. RLS is not that filter, and
`lib/auth/identity.ts` says so at the query.

### Onboarding

A newly confirmed user gets a profile, a default workspace and an owner
membership in it, via **`public.ensure_onboarded()`** — an idempotent
`SECURITY DEFINER` RPC called from the protected boundary, not an
`AFTER INSERT` trigger on `auth.users`.

The choice matters. A trigger runs inside GoTrue's own signup transaction,
where any failure surfaces to the user as an opaque "Database error saving
new user" and aborts account creation outright — the opposite of the
requirement that failure be visible and recoverable. It is also awkward to
test and cannot be retried. The RPC runs on the first authenticated request,
so a failure is an ordinary error the application surfaces and the next
request retries.

Its correctness properties:

- **Idempotent** — an existing membership short-circuits tenant creation and
  the profile insert is `ON CONFLICT DO NOTHING`. Verified across seven
  consecutive calls.
- **Concurrency-safe** — a transaction-scoped advisory lock keyed on the user
  serializes parallel first requests, so two in-flight requests cannot mint
  two workspaces.
- **No partial state** — profile, tenant and membership are one transaction.
- **Deterministic slugs** — normalized from the display name, suffixed on
  collision, with the `UNIQUE` constraint as the real guarantee.
- **No service-role key** — it runs under the caller's own session and derives
  identity from `auth.uid()`.

### Tenant selection

The active workspace is remembered in an `authority_tenant` cookie:
`httpOnly`, `SameSite=Lax`, `Secure` in production, path `/`, and it contains
a tenant id and nothing else — no role, no name, no capability.

**The cookie is a preference, not a grant.** Every request re-derives the
membership list from the database under RLS and only then checks whether the
remembered id appears in it. A forged or stale cookie therefore selects
nothing: it is ignored and the deterministic default is used instead. An
explicit workspace switch is stricter — it re-verifies membership server-side
and refuses outright rather than quietly redirecting somewhere else.

### Auth error handling and user enumeration

No raw Supabase error reaches a user. `lib/auth/errors.ts` maps known codes to
written messages and returns a generic message for anything unrecognized,
rather than passing provider text through. Server logs record the error code
and status only — never the provider message, which can embed the submitted
address or a token.

Three responses are deliberately constant:

- **Sign-in** uses one message for a missing account and a wrong password.
- **Password reset** always answers "if an account exists…" — sent, not sent,
  unknown address, rate limited or provider failure. Reporting a send-rate
  limit here would leak existence, because no mail is sent for an unknown
  address, so a per-address limit only ever trips for one that has an account.
- **Sign-up** answers "check your inbox" for a new address, an already
  registered one, and a throttled send alike. Validation errors (weak
  password, mismatch, malformed address) describe the submitted input rather
  than the account, and are surfaced.

Sign-out uses `scope: "local"`. Supabase defaults to `"global"`, which
revokes every refresh token the user holds on every device — a surprising
thing for a sign-out button to do. Ending all sessions belongs behind an
explicit control.

## Environment variables

Copy `.env.example` to `.env.local`. Only two variables are public:

| Variable                               | Required | Notes                                            |
| -------------------------------------- | -------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | yes      | `https://<ref>.supabase.co`                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes      | `sb_publishable_…`                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | no       | Legacy fallback, used only if the above is unset |

A legacy project holding an anon JWT rather than a publishable key can set
`NEXT_PUBLIC_SUPABASE_ANON_KEY` instead. The two are normalized to one field
in `lib/env.ts`, so **two public keys are never required at once**.

`lib/env.ts` validates these lazily and reports which _names_ are missing or
malformed without ever echoing a value — a configuration error frequently
ends up in a CI log or a screenshot.

CLI credentials live in `.supabase-cli.env`, read only by migration and
database-test scripts, and never by application code:

```
SUPABASE_ACCESS_TOKEN=sbp_...
SUPABASE_DB_PASSWORD=...
SUPABASE_PROJECT_REF=...
```

Both files are git-ignored. **No service-role or secret key is used anywhere
in this project.**

## Supabase workflow

```bash
npm run db:link      # link the CLI to a project (needs SUPABASE_PROJECT_REF)
npm run db:push      # apply supabase/migrations to the linked project
npm run db:diff      # show drift between migrations and the linked project
npm run db:types     # regenerate src/lib/supabase/database.types.ts
npm run db:test      # run the pgTAP suites in supabase/tests
```

The local Docker stack, when Docker is available:

```bash
npm run db:start     # start local Supabase
npm run db:reset     # recreate the local database and apply seed.sql
npm run db:stop
```

Generated types are committed. They are consumed only by `lib/auth/` and
`lib/supabase/`; the handwritten domain schemas in `lib/domain/` are
independent, and the mapping between a database row and a domain type is
explicit at that boundary rather than implied by a shared type.

### Local development limitation

**The local Supabase stack does not run in this environment** — Docker is not
installed, and there was no disk headroom for the images. Migrations and
database tests therefore run against the linked development project instead:

- Migrations are applied with `supabase db push`, which is the same mechanism
  either way.
- `npm run db:test` executes `supabase/tests/*.sql` over the Management API
  (`scripts/db-test.mjs`) rather than through `supabase test db`, which needs
  the local stack. Each suite runs in a transaction that is always rolled
  back, so the tests leave no rows behind.

Nothing about the schema or the tests depends on this; once Docker is
available, `npm run db:start && npm run db:reset` gives a local database from
the same committed migrations and seed.

### Manual Supabase dashboard settings

These cannot be expressed as migrations. `supabase config push` is
deliberately **not** used, because its `[auth]` defaults would overwrite
settings that are already correct on the project.

| Setting                                               | Value                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Authentication → URL Configuration → Site URL         | `http://localhost:3000`                                                      |
| Authentication → URL Configuration → Redirect URLs    | `http://localhost:3000/auth/callback`, `http://127.0.0.1:3100/auth/callback` |
| Authentication → Sign In / Providers → Confirm email  | **On**                                                                       |
| Authentication → Sign In / Providers → Minimum length | Raise to 12 to match the application's own rule                              |
| Project Settings → JWT Keys                           | Asymmetric signing keys, so `getClaims()` verifies locally                   |

The redirect allowlist must include the Playwright port as well as the dev
port, or the reset flow cannot be exercised by the test suite.

Email confirmation being **on** is why sign-up returns no session: the form
shows a neutral "check your inbox" state instead. The project's built-in SMTP
also has a low hourly send quota, which is why the email-sending tests assert
indistinguishability rather than a specific banner.

## Tests

| Suite                   | Count               | Command                    |
| ----------------------- | ------------------- | -------------------------- |
| Unit (Vitest)           | 938 (1 skipped)     | `npm run test`             |
| Integration (Vitest)    | 118                 | `npm run test:integration` |
| Database (pgTAP)        | 589 in 21 suites    | `npm run db:test`          |
| End-to-end (Playwright) | 181                 | `npm run test:e2e`         |
| Scenario pack (CLI)     | 28 attack scenarios | `npm run -s validate`      |

Counts are as of Part 8. The suites below were described as of Part 2A and have grown since.

**Unit** — domain schema validation against every fixture; the deterministic
evaluator's full decision matrix including semantic narrowing; environment
validation, including that a rejected value never appears in the error;
`safeReturnPath` against a corpus of open-redirect payloads; auth error
presentation and the non-enumeration properties; tenant-context resolution
including forged and malformed cookies; workspace-selection validation.

**Database** — three suites, run inside rolled-back transactions:

- _Tenant isolation_ — cross-tenant reads and writes refused, own-profile-only
  reads, `anon` denied on all three tables, plus positive controls so
  isolation is not achieved by denying everything.
- _Role escalation_ — viewer cannot change tenant settings; developer cannot
  promote itself by edit or by inserting a second row, and cannot grant itself
  another tenant; admin cannot assign, promote, demote or delete an owner;
  owner can administer others but not itself; the guard triggers hold against
  a superuser.
- _Onboarding_ — idempotent across seven consecutive calls, stable tenant id,
  slug normalization and collision suffixing, `anon` refused.

**End-to-end** — two Playwright projects. `public` runs signed out and covers
the marketing flow, all four auth forms, and the protected-route redirects.
`authenticated` signs in through the real login form in a setup project and
covers the dashboard, kill switch, accessibility/layout, and tenancy.

Tenancy coverage uses four seeded accounts across two tenants: an owner and a
viewer in Northwind Labs, an owner in Globex Payments, and an admin reserved
for the sign-out test. It asserts that the sidebar shows the real user,
workspace and role; that the selector lists exactly one entry per tenant and
never another tenant; that a forged or malformed `authority_tenant` cookie
grants nothing; and that a viewer sees their own role rather than the owner's.

### What is not automated

**Clicking the emailed links.** Email confirmation and password recovery both
require opening a message, and the suite does not read an inbox — making it
depend on one would be worse than leaving it manual. What _is_ automated: the
request side of both flows, the neutral non-enumerating responses, the
callback handler's behaviour without a code and with a provider error, and
`/reset-password` without a recovery session.

To check the remaining step by hand:

1. Sign up with a real address, or request a reset at `/forgot-password`.
2. Open the emailed link. It lands on `/auth/callback`, which exchanges the
   code and forwards to `/app` for a confirmation, or `/reset-password` for a
   recovery.
3. For a recovery, set a password of at least 12 characters and confirm it
   lands on `/app` signed in.

## Part 2B scope

Part 2A stopped at authentication and tenancy. It did not begin persistent
tasks or agents, OpenAI integration, Task Authority Contract generation, Jev
integration, capability signing, credential storage or the GitHub App.

Part 2B should replace the mocked product data with persistence, and nothing
more:

1. **Add `tenant_id` to the product schema.** New migrations for `principals`,
   `agents`, `tasks`, `task_authority_contracts`, `plans`, `plan_nodes`,
   `tool_requests`, `authorization_decisions`, `capabilities`, `approvals` and
   `execution_events`, each carrying `tenant_id` with an RLS policy built on
   the existing `authz.is_member_of()`. Reuse those helpers rather than
   writing new membership logic.
2. **Implement `AuthorityRepositories` against Supabase**, alongside the
   in-memory implementation rather than replacing it, so unit tests keep a
   fast deterministic backend. The interfaces in `lib/domain/repositories.ts`
   should not need to change.
3. **Map database rows to domain types explicitly.** The domain uses prefixed
   string ids (`task_1842`) and the tables use UUIDs; `Tenant` has no
   `environment`, `created_by` or `updated_at` while the table does. Decide
   whether to widen the domain schemas or keep a translation layer, and write
   that boundary down.
4. **Thread the real tenant through the loaders.** `loadDashboardOverview`
   and `loadNavBadges` currently default to the demo fixture tenant; they
   should take the resolved tenant id and have no default.
5. **Seed a per-tenant demo dataset** so a new workspace is not empty, and
   remove `DemoDataNotice` once the records shown are the tenant's own.
6. **Add RLS tests for every new table** following the existing three suites,
   including the cross-tenant negative cases.

Deferred deliberately to their own parts: marking actions as requiring live
semantic evidence and failing them closed when a provider is unavailable
(the behaviour this README used to overstate), capability issuance and
signing, the credential broker, and the GitHub App.
