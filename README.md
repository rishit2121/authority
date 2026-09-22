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

## MVP status — this is Part 1

This repository is the frontend foundation and a **mocked product shell**.
Concretely, in this build:

- **All application data is mocked.** Every tenant, agent, task, contract,
  decision, capability and event comes from fixtures in `src/lib/mock/`, not
  a database.
- **There is no real enforcement.** The deterministic evaluator in
  `src/lib/authorization/evaluate.ts` is real, tested logic — but nothing in
  this build sits in front of an actual GitHub, Stripe or Slack API. No
  credential is ever issued, held or used.
- **There is no authentication.** The signed-in user in the sidebar
  (`src/lib/mock/demo-identity.ts`) is a fixed fixture. "Sign out" says
  plainly that it is a demo action.
- **No external network calls are made.** The semantic decision provider is
  a local heuristic (`MockSemanticDecisionProvider`), not a call to Jev or
  any other service.

See **[Part 2 preview](#part-2-preview-supabase-authentication-and-persistence)**
for what turns this from a shell into a working product.

## Architecture overview

```
src/
  app/
    (marketing)/          /  and  /demo         — public marketing layout + pages
    app/                  /app and its children  — control-plane dashboard
  components/
    marketing/             Landing page sections, header, footer
    graph/                 The agent-centred radial authority graph
    demo/                  The /demo guided walkthrough
    dashboard/              Sidebar, shell, metric cards, task table
    task/                  The task investigation view and its panels
    ui/                    Shared primitives (Icon, Section, DecisionStatusBadge, …)
  lib/
    domain/                Zod schemas, inferred types, repository interfaces
    authorization/         The deterministic evaluator + semantic decision port
    mock/                  In-memory repositories and fixture data
    data/                  Loaders: page → loader → repository seam
  hooks/                   useReducedMotion, useSidebarCollapsed, useFocusTrap
  styles/                  globals.css
  tests/
    unit/                  Vitest + Testing Library
    e2e/                   Playwright
```

Domain logic is deliberately kept out of `components/`. A page calls a
loader in `lib/data/`; a loader reads through the `AuthorityRepositories`
interface in `lib/domain/repositories.ts`; today that interface is bound to
an in-memory implementation in `lib/mock/`. No component imports a fixture
directly — swapping the in-memory repositories for a real database in Part 2
should not require touching a single component.

## Routes

| Route                                                                                  | What it is                                                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                                    | Marketing landing page. The hero contains the animated authority graph.                                               |
| `/demo`                                                                                | A nine-step guided walkthrough of one authorization pass, built on the GitHub #991 scenario.                          |
| `/app`                                                                                 | The control-plane dashboard: sidebar, overview metrics, recent task traces.                                           |
| `/app/tasks`                                                                           | All mocked tasks for the tenant.                                                                                      |
| `/app/tasks/demo-task`                                                                 | The full investigation view for the GitHub #991 task: contract, plan, decisions, capabilities, timeline, kill switch. |
| `/app/agents`, `/app/policies`, `/app/integrations`, `/app/approvals`, `/app/settings` | Present in navigation; each states plainly that it is not implemented in this build.                                  |

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
These are interfaces only; this repository contains no Supabase
references anywhere.

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
**High-risk, semantic-required actions fail closed on provider timeout or
error** — `hasUsableEvidence` treats anything other than `state: "ok"` as no
evidence at all, and the deterministic result stands rather than defaulting
to permissive. This is exercised directly in
`src/tests/unit/authorization-evaluate.test.ts`.

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
npm run dev          # http://localhost:3000
```

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
| `npm run verify`                  | format:check → lint → typecheck → test → build, in order                                        |

First-time Playwright setup needs the browser binary once:

```bash
npx playwright install chromium
```

## Tests

- **Unit** (`src/tests/unit/`, Vitest + Testing Library): domain schema
  validation against every fixture, the deterministic evaluator's full
  decision matrix including the semantic-narrowing and fail-closed paths,
  and decision-status rendering.
- **End-to-end** (`src/tests/e2e/`, Playwright, Chromium): the marketing
  flow through to a denied-secret assertion on the full task investigation;
  dashboard navigation across every sidebar link, sidebar collapse
  persistence, and the mobile drawer's focus trap; the kill-switch flow
  (cancel leaves state untouched, confirm terminates the task, revokes
  capabilities, and appends a timeline event); and accessibility/layout
  checks — zero horizontal overflow and zero console errors on all four
  routes at 1440px, 834px and 390px, keyboard operability, visible focus,
  and `prefers-reduced-motion` rendering. Assertions are on content and
  state, never on animation timing or pixel coordinates.

## Part 2 preview: Supabase authentication and persistence

Part 1 deliberately stops at the repository interface. Part 2 begins by:

1. Standing up Supabase (Postgres + Auth) and writing a second
   implementation of `AuthorityRepositories` against it, alongside — not
   replacing — the in-memory one, so tests keep a fast, deterministic
   backend.
2. Wiring real sign-in, replacing the fixed `DEMO_USER` in
   `lib/mock/demo-identity.ts` and making "Sign out" actually end a session.
3. Persisting tasks, contracts, decisions, capabilities and events as they
   are created, instead of reading a frozen fixture set.
4. Only after that: connecting one real tool provider (GitHub, per the
   original MVP scope) behind the existing `evaluateToolRequest` flow, with
   Jev arriving as an additional `SemanticDecisionProvider` implementation
   once the deterministic path is proven against real data.

No Supabase code, functional authentication, or external API integration
exists in this repository yet — those begin in Part 2.
