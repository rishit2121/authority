# Authority

**An agent gets the authority for its task, not the authority of its API key.**

Authority is a task-scoped authorization gateway for AI agents. A trusted application describes what a task may do;
Authority compiles that into a contract (which tools, which recipients and resources, how many times), binds a
short-lived session to the task, decides every call against the contract in the database before anything runs, and
can execute provider actions itself so the agent never holds provider credentials. Every decision is recorded.

> **Experimental release (v0.x). Not production-proven, not audited.** The deterministic core is tested: unit tests,
> pgTAP suites on a throwaway database, and a real-API evaluation with no model or provider calls. It has had no
> third-party audit, and it does not guarantee against every misuse. Know these limits before relying on it:
>
> - **Open free text.** A message body, subject or title that the plan leaves open, or binds to an earlier step, can
>   say anything. Authority pins targets and values, not content.
> - **Budgets carry across re-preparation only for the same action.** An action's `maxInvocations` (tool plus its
>   exact pinned values) counts over every contract version of the task, and only the backend or an admin can raise
>   it. A step with a new pinned value is a new action with its own budget, and there is no total across all actions.
> - **Model review is optional and probabilistic.** Task alignment, content screening and risk review can only
>   narrow a decision, and they are off unless you turn them on. Backend prepare skips Jev checks but can run
>   task-alignment plan review. If you ask for an AI-drafted plan (`generate: true`), a model chooses the task's
>   scope.
> - **Security-relevant values derived from earlier steps are unsupported.** A recipient, channel, id or amount must
>   be concrete in the plan.
> - **Simulated execution is not provider execution.** `/capabilities/consume` calls no provider.
> - **Browser agents are not covered by this release.** A separate experiment confined a browser agent's navigation
>   URLs: Authority denied 4 of 4 injected navigations in a small matched run. It did not govern form submissions or
>   scripts on an already-permitted page, and the integration is not part of this repository.
>
> Details: [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## What it enforces

- **Exact values and budgets.** A plan step that sends to `alice@example.com` compiles to an action that only sends
  to `alice@example.com`, at most N times. A different recipient, channel, id, amount or tool is refused. An argument
  the plan never set is refused too, except free text the plan left open (a message body, a title).
- **Task and customer binding.** A task belongs to one customer of one application; a task session is valid only for
  its own task; a backend credential cannot act for another application's customer.
- **Atomic decisions.** Authorization is decided and committed in PostgreSQL (`SECURITY DEFINER` functions reachable
  only by a dedicated gateway role), with idempotent replay and single-use, short-lived capabilities.
- **Credential-holding execution.** For connector tools (GitHub, Gmail, Slack, Stripe, Linear, Notion, PostgreSQL,
  your own HTTPS API) Authority performs the call with exactly the authorized arguments; the agent never sees the
  provider credential, URL or method. Outcomes are recorded as receipts; an uncertain write is never retried.
- **Model checks cannot widen authority.** Optional model-based checks (task alignment, content screening, risk
  review) can only narrow a deterministic decision, never grant one. The optional AI plan drafter is different: with
  `generate: true` its plan becomes the contract after the same deterministic validation, so use it only where a
  model choosing the task's scope is acceptable.

## What it does not do

- It is **not a prompt-injection detector.** Optional screening reports or quarantines outside content, but it is
  probabilistic, and nothing certifies an unchecked source as safe.
- It governs **only calls routed through it.** An agent with other credentials, a browser that follows links or
  submits forms, or a shell, needs controls at that execution boundary.
- A contract is as good as its plan. Authority checks that a plan is well formed and pins its values; it does not
  prove the plan is what the user meant. Values a plan derives from earlier outputs are allowed only for free text.

Details: [docs/SECURITY.md](docs/SECURITY.md) (threat model and guarantees),
[docs/LIMITATIONS.md](docs/LIMITATIONS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (trust boundaries),
[docs/ENFORCEMENT_PROFILE.md](docs/ENFORCEMENT_PROFILE.md) (which checks run on which entrypoint).

## How a call flows

```
trusted app ──backend key──▶ create task (customer, agent, request)
                            prepare(plan) ─▶ validate ─▶ minimum-authority solve ─▶ compile ─▶ verify ─▶ activate
agent ──runtime key──▶ open task session
agent ──session──▶ /authorize(tool, arguments) ─▶ SQL: task, contract, pinned values, budget ─▶ capability
agent ──session──▶ /execute(capability) ─▶ connector with Authority-held credentials ─▶ receipt
```

## Quickstart (local, no cloud account)

Requires Node 22 and Docker. Everything runs on your machine against a throwaway database.

```bash
npm ci
npx supabase start                      # local Postgres + Auth; applies supabase/migrations and the seed
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "alter role authority_gateway with login password 'ci-only-gateway-password'"
```

(A throwaway password for a throwaway database; the local test suites and CI use the same one.)

Create `.env.local` (local values only):

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY from `npx supabase status -o env`>
GATEWAY_DATABASE_URL=postgresql://authority_gateway:ci-only-gateway-password@127.0.0.1:54322/postgres
GATEWAY_DATABASE_SSL=disable
AUTHORITY_DEPLOYMENT=local
```

Then `npm run dev`, open http://localhost:3000, and sign in as a seeded fixture user (`owner.a@authority.test`,
password in `src/tests/local/local-env.ts`), or sign up. Model features stay off without model keys.
Full walkthrough, including putting your own agent behind Authority: [docs/QUICKSTART.md](docs/QUICKSTART.md).

## Use it from your code

```js
import { AuthorityBackendClient, AuthorityAgentClient } from "@authority/sdk"; // packages/authority-sdk

const backend = new AuthorityBackendClient({ baseUrl: url, apiKey: process.env.AUTHORITY_BACKEND_API_KEY });
const { customerId } = await backend.customers.ensure({ externalId: "user-123" });
const { taskId } = await backend.tasks.create({ customerId, agentId, intent: "Post today's status to #ops" });
await backend.tasks.prepare(taskId, {
  plan: {
    schemaVersion: 1,
    nodes: [
      {
        id: "post",
        sequence: 1,
        tool: "slack.post_message",
        // Every value is pinned. Slack's `text` is required, so it cannot be left for the agent to write;
        // an optional free-text field (an email body, an issue description) can be.
        arguments: { channel: "C-ops", text: "Deployed." },
        expectedSideEffect: "write_create",
      },
    ],
  },
}); // "ready", plus excludedSteps for anything it could not compile

const agent = new AuthorityAgentClient({ baseUrl: url, token: process.env.AUTHORITY_AGENT_RUNTIME_KEY });
await agent.sessions.create({ taskId }); // this client can now act on this task only
// Executing needs this customer to have a Slack connection; authorization alone does not.
await agent.tools.execute({
  taskId,
  tool: "slack.post_message",
  arguments: { channel: "C-ops", text: "Deployed." },
});
```

More: [packages/authority-sdk](packages/authority-sdk), [examples/](examples), [docs/api/RUNTIME_API.md](docs/api/RUNTIME_API.md),
[docs/api/OPENAPI.yaml](docs/api/OPENAPI.yaml).

## Tests

| Command                                                                               | What it runs                                                   | Needs                                                                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                            | unit tests (authorization, compiler, connectors, routes, ...)  | nothing                                                                                                     |
| `DB_TEST_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:test` | pgTAP database security suites                                 | `supabase start`, then `create extension pgtap with schema extensions`                                      |
| `npm run test:local`                                                                  | local-database suites, including the real-API evaluation       | `supabase start`, the gateway login above, `eval "$(npx supabase status -o env)"`                           |
| `npm run test:e2e:local`                                                              | dashboard end to end                                           | the same, plus Playwright                                                                                   |
| `npm run verify`                                                                      | format, lint, typecheck, unit tests, build, bundle secret scan | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set (placeholders are fine, as in CI) |

CI runs all of these on every pull request against a throwaway local Supabase (`.github/workflows/ci.yml`). Without
`DB_TEST_URL`, `npm run db:test` targets a linked hosted project; never point it at production.

## Repository layout

- `src/lib/authorization/` plan validator, solver, compiler, verifier, evaluator
- `src/lib/gateway/` runtime pipeline (sessions, authorize, prepare) and its database calls
- `src/lib/connectors/` connector executor and connectors; `src/lib/github/` GitHub execution
- `src/lib/alignment/`, `src/lib/jev/`, `src/lib/semantic/` optional model-based checks (narrow-only)
- `supabase/migrations/` schema and `gateway.*` functions; `supabase/tests/` pgTAP suites
- `src/app/api/` HTTP and MCP endpoints; `src/app/app/` dashboard
- `packages/authority-sdk/` TypeScript SDK; `examples/` runnable examples

## Security

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE). The vendored fonts, the provider logos and some dependencies keep their own terms; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the dependency review in [docs/LICENSES.md](docs/LICENSES.md).
