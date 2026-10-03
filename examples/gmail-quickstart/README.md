# Gmail quickstart

Connects your own agent to Authority and runs a real, bounded, read-only task from code: list a customer's Gmail
labels, with no manual API requests and no dashboard visit per task. Uses `@authority/sdk`
(`../../packages/authority-sdk`), the thin TypeScript client over the developer API.

## One-time setup

1. From the repo root: `npm install && npm run sdk:build`
2. `cp .env.example .env.local` in this directory and fill in:
   - `AUTHORITY_BACKEND_API_KEY` — Settings → Applications → (your application) → Backend credentials.
   - `AUTHORITY_AGENT_ID` / `AUTHORITY_AGENT_RUNTIME_KEY` — Agents → New agent, then that agent → Issue runtime
     credential.
3. Register this script's fixed return URL on your application (Settings → Applications → Return URLs):
   `http://127.0.0.1:4300/connected`

## Run

```
npm start
```

The first run opens a browser URL for one-time Google consent (Mode A — Authority hosts the OAuth flow; your
customer never sees or needs an Authority credential). Every later run for the same `CUSTOMER_EXTERNAL_ID`
reuses that same connection — no repeated consent, no manually copied tokens.

The first run will also stop at `awaiting_approval` — open the printed dashboard link and activate the
contract once. This is expected, not a limitation of this script: Authority's registry groups
`gmail.list_labels` with two sibling read operations under one bundled permission, so the solver can't grant
`list_labels` alone without including them as excess scope, which always requires a human sign-off regardless
of any automation-policy allowlist (Settings → Applications → Automation only ever narrows which _already
zero-approval_ contracts activate automatically — it can never waive a genuine one). A tool with its own
dedicated, unbundled permission — see `github.get_issue` in
`src/tests/integration/runtime/task-lifecycle-backend.test.ts` — reaches full automatic activation; this
example keeps the one-time human click instead, since it's the more common real-world case. Re-running the
script afterward picks up the now-active contract and runs the tool call.

The only tool call this script ever makes is the read-only `gmail.list_labels`. It never sends email.

## What this proves end to end

- A customer and their Gmail connection are created once and reused on every later run (idempotent).
- A task is created with that connection explicitly bound to it (idempotent).
- A candidate plan is submitted and compiled into a contract through the same deterministic pipeline the
  dashboard uses — never a second, weaker authorization path for API-driven callers.
- The contract waits for exactly one human click (this tool's permission is bundled with siblings the plan
  doesn't request, so it always needs sign-off) — a tool with its own dedicated permission can activate fully
  automatically instead, never silently either way.
- The agent exchanges its runtime key for a short-lived session, fetches the contract-filtered tool manifest,
  and runs exactly one authorized call through the mandatory authorize → capability → execute sequence.
