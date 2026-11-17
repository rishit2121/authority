# Proof Run

One task, four attempts, decided by a real local Authority:

> Post one update in #engineering. Don't email anyone.

| Attempt                    | Expected                                             | Why                                                                                            |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Post to #engineering       | Allowed and executed, one provider request           | Right tool, pinned channel, budget available                                                   |
| Post to #general           | Blocked before dispatch (`CONSTRAINT_VIOLATION`)     | The channel is pinned to #engineering. Runs in a fresh task, so the budget is not why it fails |
| Post again to #engineering | Blocked before dispatch (`INVOCATION_LIMIT_REACHED`) | The task allows one post. A new attempt with a new idempotency key is refused, not retried     |
| Send an email              | Blocked before dispatch (`TOOL_NOT_IN_CONTRACT`)     | Email is not part of this task                                                                 |

## Files

- [`engineering-update.json`](engineering-update.json) is the recipe, and the only definition of the scenario. The website, the runner and the CLI all read it. It holds no secrets, user IDs or real connection identifiers. The channel IDs are synthetic.
- [`captured-run.json`](captured-run.json) is the sanitized transcript the website plays back. It was captured by the runner below against the mock Slack transport. Receipt IDs are shortened and come from a throwaway local database. The file records the recipe's hash. When the recipe changes, the site says the capture no longer covers it until you capture again.

## Run it

You need Node 22+ and Docker. From the repository root:

```sh
npm ci
npx supabase start
npm run authority -- demo
```

`demo` runs [`src/tests/local/proof-run.test.ts`](../../src/tests/local/proof-run.test.ts). That test creates a throwaway application, agent, customer and Slack workspace-bot connection in your local Supabase. The connection holds a mock token and is shared with exactly one customer by an admin grant. The test then calls Authority's own route handlers: create task, prepare, open a session, authorize, execute.

The Slack connector's transport is replaced, in that test process only, by a mock that counts requests. A Gmail transport that must never be called is installed alongside it. Nothing leaves your machine, and production egress protection is not changed.

The command exits non-zero if any of these happen:

- an expected block becomes an allow
- a reason code changes
- the mock provider receives a request the recipe does not expect

To check a variation, point the runner at another recipe:

```sh
npm run authority -- demo --recipe path/to/recipe.json
```

To refresh the transcript after an intentional change:

```sh
npm run authority -- demo --capture
```

## What this proves, and what it doesn't

It proves that Authority's prepare, session, authorize and execute path allows the in-scope post exactly once and blocks the other three attempts before any provider request.

It does not exercise a real Slack workspace or Slack's own behaviour. For that, connect a real workspace in the dashboard and use the connector quickstart.
