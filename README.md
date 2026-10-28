<p align="center">
  <img src="docs/assets/authority-logo.png" alt="Authority" width="360" />
</p>

<p align="center">
  <strong>Give your agent the permissions its task needs.</strong>
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#optional-ai-checks">AI checks</a> ·
  <a href="#current-limitations">Limitations</a> ·
  <a href="SECURITY.md">Security</a>
</p>

## Why Authority

An agent can understand a request and still take an action that doesn’t belong. Ask it to post an update in Slack, and it might also send an email. Ask it to summarize a document, and instructions inside that document might lead it somewhere else.

The tools can work exactly as designed while the outcome makes no sense for the task.

Authority puts a permission boundary between the agent and those tools. Your application submits a task plan, and Authority compiles it into a contract describing what the agent may do. Each call is checked against that contract before execution.

A task might allow one message to a specific Slack channel. That permission doesn’t extend to another channel, a second message, or an email the plan never included. When message text is explicitly left open, the agent can choose the words while Authority still enforces the destination and usage limit.

For supported connectors, Authority also executes approved calls with credentials it holds. The agent doesn’t need the underlying provider token, and decisions and execution receipts give you a record of what happened.

The goal is simple: let agents do useful work without giving every task the full authority of an API key.

> **Experimental software.** Authority’s deterministic boundary is tested, but the system is not independently audited or production-proven. It governs calls routed through it, and a contract does not prove that a plan matches the user’s intent. Read the [current limitations](docs/LIMITATIONS.md) before relying on it.

## Get started

### Run locally

You’ll need Node.js 22, Docker and `psql`. The local setup uses a disposable Supabase database.

```bash
git clone https://github.com/rishit2121/authority.git
cd authority
npm ci
npx supabase start
```

Give the local gateway role its development login:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "alter role authority_gateway with login password 'ci-only-gateway-password'"
```

This password is for the disposable local database only.

Run the following to find your local Supabase settings:

```bash
npx supabase status -o env
```

Create `.env.local` using those local values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your local ANON_KEY>
GATEWAY_DATABASE_URL=postgresql://authority_gateway:ci-only-gateway-password@127.0.0.1:54322/postgres
GATEWAY_DATABASE_SSL=disable
AUTHORITY_DEPLOYMENT=local
```

Start the application:

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000).

The deterministic authorization system works without model credentials. Optional AI features require their own configuration.

Follow the [complete quickstart](docs/QUICKSTART.md) to create an application, register an agent, connect a service and run your first task.

### Try the hosted pilot

If you’d rather try Authority without hosting it yourself, [request access to the pilot](https://authority-d2zf.onrender.com/request-access).

The hosted pilot is invite-only. Connected services perform real actions, so start with test accounts and disposable resources.

## How it works

Authority separates deciding what an agent may do from the agent’s decision about what to do next.

### 1. Your backend creates a task

A task belongs to an application customer and an agent. Your backend supplies the trusted request and binds the connections that customer may use.

Backend credentials stay on your server. The agent receives a task session for runtime calls.

### 2. A plan becomes a contract

Your application submits a plan, or uses the optional planner to draft one.

Authority validates its tools, arguments, dependencies and applicable policies. A solver selects the minimum catalog permissions covering the included steps, and the compiler turns those steps into explicit allowed actions.

The contract contains pinned argument values, invocation budgets, an expiry and version information. Verification rebuilds the expected contract and checks consistency before activation.

Configured approval rules can require a person to approve it. Optional alignment review can also hold a plan for revision or review.

### 3. Each call is authorized

Before a call runs, Authority checks the credential, task session, active contract, arguments and remaining budget.

An allowed call receives a short-lived capability bound to that request. A refused call receives a reason the application can act on.

These checks are deterministic. A model cannot override a contract refusal.

### 4. Approved calls execute

For supported connectors, Authority executes the call using its stored provider credential and the authorized arguments.

Execution produces a receipt. Failed or uncertain writes are distinguished from actions that never dispatched, so an application can avoid blindly repeating an operation.

Authorization decisions and execution receipts are separate records: permission to run is not evidence that a provider action completed.

## What a contract controls

| Boundary       | Example                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| Tools          | Permit `slack.post_message`, without permitting `gmail.send_email`.                           |
| Targets        | Pin a channel, recipient, issue ID or payment ID.                                             |
| Values         | Pin an amount or another supported scalar argument.                                           |
| Generated text | Explicitly leave supported text fields open while keeping the destination fixed.              |
| Usage          | Permit a defined number of invocations of an action. Re-preparing the task does not reset it. |
| Time           | Refuse calls after the contract or session expires.                                           |
| Identity       | Bind a session to one task and its customer’s usable connections.                             |

The solver minimizes permissions for the submitted plan. It does not prove that every step is necessary for the original request.

Provider credentials may still carry broad permissions. Authority narrows how those credentials can be used through its execution path.

## A concrete example

Suppose the task is:

> Post “The deployment is complete” to our engineering updates channel. Don’t send an email.

A corresponding plan step could be:

```json
{
  "id": "post-update",
  "sequence": 1,
  "tool": "slack.post_message",
  "arguments": {
    "channel": "C-eng-updates",
    "text": "The deployment is complete."
  },
  "expectedSideEffect": "write_create",
  "maxInvocations": 1
}
```

This is a plan fragment, not a complete API request.

Once prepared and activated, the contract permits that message to that channel once. Changing the channel, changing the pinned text, using an unlisted tool or exceeding the budget is refused.

If the agent needs to write the message itself, for example a summary after reading data, a supported free-text field can instead be marked as agent-written by listing it in `agentGenerated`. The destination remains pinned.

Open text is not deterministically checked for correctness or sensitive information. See the [agent-written message example](docs/QUICKSTART.md#3-let-the-agent-write-a-message-after-it-reads-data) for the supported flow.

## Integrate with your agent

Authority exposes an HTTP API, a TypeScript SDK and an MCP interface.

Your backend manages customers, tasks and preparation. Your agent uses a task session to discover its permitted tools and request execution.

The usual lifecycle is:

1. Resolve or create the application customer.
2. Create a task and bind usable connections.
3. Prepare its plan.
4. Handle approval, revision or clarification if required.
5. Create a task session.
6. Fetch the permitted tools and execute calls.
7. Inspect decisions and execution receipts.

Start with:

- [Integration quickstart](docs/QUICKSTART.md)
- [TypeScript SDK](packages/authority-sdk)
- [Runnable examples](examples)
- [Runtime API](docs/api/RUNTIME_API.md)
- [OpenAPI specification](docs/api/OPENAPI.yaml)

Only expose task-session credentials to the agent. Keep backend credentials and provider credentials outside model-controlled context.

## Optional AI checks

A contract answers:

> Does this call stay within the approved scope?

Optional AI checks address a different question:

> Does this plan or action make sense for the user’s request?

### Task alignment

Alignment review compares proposed plans and tool calls with the original request and its objectives. It can flag an extra action, a conflicting value or a request that needs clarification.

- **Off:** no alignment review.
- **Shadow:** record findings without changing authorization.
- **Enforce:** findings can stop or hold an action.

These are model judgments. They can miss problems or hold legitimate work. They never grant a call the deterministic contract refuses.

### External-content screening

Your application can optionally submit outside content before its agent sees it. Authority can also screen supported connector results.

Screening can report findings or quarantine content. It does not require your application to submit every piece of agent context.

“Not inspected” is different from “passed.” Screening does not sanitize a document or certify that it is safe.

Optional checks differ by entrypoint. Backend preparation can run task-alignment review but skips the separate Jev necessity and completeness checks. See the [enforcement profile](docs/ENFORCEMENT_PROFILE.md) for the exact behavior.

## Connectors

Authority includes connectors for:

- Gmail
- Slack
- GitHub
- Stripe
- Linear
- Notion
- PostgreSQL
- Custom HTTPS APIs

Connection setup and identity depend on the provider. Gmail supports customer OAuth connections. Slack uses the configured bot identity. GitHub uses its App installation and repository access. Other connectors use configured credentials and access policies.

Delegating a connection controls who may use it. It does not automatically make a shared credential impersonate each customer.

Implementation and test coverage should not be mistaken for live verification of every provider. See the connector documentation and [limitations](docs/LIMITATIONS.md) before connecting real accounts.

## Current limitations

Authority’s boundaries are important to understand:

- **The plan can be wrong.** Structural validation and compilation do not prove that it matches the user’s intent.
- **Only routed calls are governed.** Other credentials, shell commands, browser submissions and page-issued requests need controls at their execution boundary.
- **Open text remains open.** Deterministic checks do not establish that a message is accurate or contains no sensitive information.
- **Security-relevant derived values must be resolved first.** Recipients, channels, IDs and amounts need concrete values in the plan. Receipt-backed provenance is not implemented.
- **Budgets carry over only for the same action.** An action’s budget spans re-preparations of the task, but a step with a different pinned value is a new action with its own budget, and the total across all actions is still per contract version.
- **Model reviews are probabilistic.** Shadow evidence is best effort, and reviewer limits are per process.
- **Simulation is not execution.** Consuming a simulated capability does not call a provider.

Read the full [limitations](docs/LIMITATIONS.md), [security model](docs/SECURITY.md) and [architecture](docs/ARCHITECTURE.md).

## Testing

Authority tests the compiler, runtime authorization, database security rules and execution lifecycle at several levels.

| Command                  | Coverage                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`               | Unit tests.                                                                                                                                      |
| `npm run verify`         | Formatting, lint, type checking, unit tests, production build and bundle secret scanning. Requires the documented public Supabase configuration. |
| `npm run test:local`     | Integration tests against local Supabase, including real API handlers.                                                                           |
| `npm run test:e2e:local` | Local dashboard browser tests.                                                                                                                   |

For database security tests, explicitly target the disposable local database. The suites need the pgTAP extension:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "create extension if not exists pgtap with schema extensions"
DB_TEST_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:test
```

The local integration and browser tests also need the gateway login above and the local Supabase settings in the environment (`eval "$(npx supabase status -o env)"`). Never point test suites at a production database.

The local API tests exercise actual authorization handlers with synthetic data. Mock-provider tests exercise controlled execution and race conditions. Neither establishes real-provider behavior or model accuracy.

When evaluating attacks, measure unauthorized effects and legitimate task completion separately. A model declining an injected instruction is not the same as Authority refusing a call.

## Research foundations

Authority draws on established research and security ideas, including least privilege, capability-based authorization and separation of planning from execution.

Relevant work includes:

- [MiniScope](https://arxiv.org/abs/2512.11147), on task-centric least-privilege permissions for agents.
- [Task Shield](https://aclanthology.org/2025.acl-long.1435/), on checking whether instructions and tool calls contribute to user objectives.

Authority’s implementation, extensions and evaluations are separate from those papers. Their reported results are not Authority’s results, and citation does not imply endorsement.

## Project structure

| Path                                | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `src/lib/authorization/`            | Plan validation, permission solving, compilation and verification. |
| `src/lib/gateway/`                  | Task preparation, sessions and runtime authorization.              |
| `src/lib/connectors/`               | Provider connectors and execution.                                 |
| `src/lib/github/`                   | GitHub execution path.                                             |
| `src/lib/alignment/`                | Optional task alignment and content screening.                     |
| `src/lib/jev/`, `src/lib/semantic/` | Additional optional review paths.                                  |
| `supabase/`                         | Database migrations and security tests.                            |
| `packages/authority-sdk/`           | TypeScript SDK.                                                    |
| `examples/`                         | Integration examples.                                              |

## Contributing

Bug reports, documentation improvements and small, reproducible examples are welcome.

For authorization bugs, include the expected boundary, observed behavior and a reproduction using synthetic data. Don’t include credentials, private messages or customer information.

Keep security-sensitive reports private using the process below.

## Security

Please report vulnerabilities through the private reporting process described in [SECURITY.md](SECURITY.md), rather than a public issue.

## License

Authority is available under the [MIT License](LICENSE).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party attribution and licensing.
