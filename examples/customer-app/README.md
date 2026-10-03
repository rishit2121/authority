# Customer connections example

A minimal, runnable demonstration of embedded customer connections, separate
from the Authority control plane. It uses only the public developer API
(`POST /api/v1/customers`, `/api/v1/connections/sessions`,
`/api/v1/customers/{id}/connections`, `/api/v1/customers/{id}/tasks`) —
never a direct database write, never an internal bypass.

See [`/docs/customer-connections`](<../../src/app/(marketing)/docs/customer-connections/page.tsx>)
on the running deployment for the full concepts this demonstrates.

## What it proves

Two independent customers, Alex and Bob, each connect their own Gmail
account. A task created for Alex naming her own connection succeeds. The
same call naming Bob's connection instead is refused — before Authority
ever creates a task or dispatches anything — because a connection belongs
to exactly one customer (or is explicitly delegated), never "whoever asks."

## Setup

You need an application, a backend credential, and an agent already created
on the Authority deployment you're pointing this at — all three are
dashboard actions by design (see the docs page above for why):

1. Dashboard → Settings → **Developer applications** → create one.
2. Open it → **Backend credentials** → issue one. Copy the `authority_dk_...`
   secret shown — it is never shown again.
3. Dashboard → **Agents** → create one (or use an existing one) → copy its
   id from the page URL.

```bash
export AUTHORITY_URL=http://localhost:3000
export AUTHORITY_BACKEND_KEY=authority_dk_...
export AUTHORITY_AGENT_ID=<agent id>
```

### Running against mocks (repeatable, no real Google account)

Start the Authority dev server with Gmail's fixture mode enabled, so the
embedded connect flow completes without a browser or a real Google account:

```bash
GMAIL_FIXTURE_MODE=1 npm run dev
```

Then, in another terminal:

```bash
node examples/customer-app/demo.mjs
```

### Running against your own disposable Gmail account (opt-in, live)

Drop `GMAIL_FIXTURE_MODE=1` and configure real Google OAuth credentials on
the server (`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`; see
[`/docs/connectors/gmail`](<../../src/app/(marketing)/docs/connectors/gmail/page.tsx>)).
`demo.mjs`'s `simulateEmbeddedConnect` helper only works against the
fixture's own immediate-redirect "consent screen" — for a real account, open
the URL `createConnectionSession` returns in an actual browser instead and
authorize with a disposable Gmail account you control. This demo never
sends email or mutates anything in that account; it only reads the
connector's own read-only operations (`list_messages`, `get_message`).

## The one manual step this demo doesn't automate

Compiling and activating a task's authority contract remain dashboard
actions in this increment (same as task creation itself was before the
developer API existed) — `demo.mjs` creates the task and its connector
binding, but stops there. To see an actual authorized tool call and its
result:

1. Open the task `demo.mjs` printed in the dashboard.
2. Propose and activate a simple read-only contract for it (e.g. allowing
   `gmail.list_messages`).
3. Run the existing agent example against that task, using an agent runtime
   key (not the backend credential — see
   [`../agent/README`](../agent) if present, or `/docs/quickstart`):

```bash
AUTHORITY_URL=$AUTHORITY_URL \
AUTHORITY_AGENT_KEY=<runtime key for the same agent> \
AUTHORITY_TASK_ID=<the task id demo.mjs printed> \
node ../agent/sample-agent.mjs
```

This last step reuses the existing, already-proven agent-facing runtime API
end to end (task session → tool manifest → authorize → execute) — nothing
about it is specific to customer connections; the only difference is whose
connection the task is bound to.

## A single-command live verification: `live-gmail-test.mjs`

A self-contained alternative to the manual steps above, for verifying the
whole customer-owned flow against one real, disposable Gmail account in one
run: Alex connects (no Authority login), the connection is confirmed to
belong to her alone, her task explicitly binds it, Bob's attempt to bind the
same connection is confirmed refused, and — after you activate a contract
for Alex's task in the dashboard — exactly one `gmail.list_labels` call runs
through authorize → execute and its receipt is verified. It never sends
email.

Prerequisites:

- A real `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` configured on
  the Authority server, **not** running with `GMAIL_FIXTURE_MODE`.
- That OAuth client's consent screen must authorize the redirect URI
  `http://localhost:3000/api/connectors/gmail/embedded-callback` — the
  embedded flow's own callback, distinct from the dashboard's
  `/api/connectors/gmail/callback`.
- An application (dashboard: Settings → Developer applications) whose
  allowed return URLs include exactly `http://127.0.0.1:4100/connected` —
  this script always uses that fixed port, so you can register the URL
  before running it.
- An agent already created (dashboard: Agents).

```bash
node examples/customer-app/live-gmail-test.mjs
```

It reads `AUTHORITY_BACKEND_KEY` from `.env.local` if present there, or
prompts for it (and later, the agent's runtime credential) without echoing
either back. It prints the connect URL for you to open in a real browser,
waits for that browser to return, then verifies each step above from the
API's own responses before moving to the next. The one thing it cannot do
for you is revoke the runtime credential afterward — that requires a
signed-in dashboard admin session — so it ends by telling you to do that.
