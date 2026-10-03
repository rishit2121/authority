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
4. Optional, for fully automatic activation without any dashboard click: Settings → Applications → (your
   application) → Automation → allow-list `gmail.list_labels`. This tool has its own dedicated registry
   permission (`gmail.labels_read`), disjoint from `gmail.list_messages`/`get_message`'s permission, so
   allow-listing it can never grant message-reading access — see
   `src/lib/registry/fixtures/github-demo.ts`'s comment on `gmail.labels_read` for why. Without this step, the
   script still works end to end; it just stops at `awaiting_approval` the first time, until a human activates
   the proposed contract once from the dashboard — re-running the script afterward picks up the now-active
   contract and runs the tool call.

## Run

```
npm start
```

The first run opens a browser URL for one-time Google consent (Mode A — Authority hosts the OAuth flow; your
customer never sees or needs an Authority credential). Every later run for the same `CUSTOMER_EXTERNAL_ID`
reuses that same connection — no repeated consent, no manually copied tokens.

The only tool call this script ever makes is the read-only `gmail.list_labels`. It never sends email.

## What this proves end to end

- A customer and their Gmail connection are created once and reused on every later run (idempotent).
- A task is created with that connection explicitly bound to it (idempotent).
- A candidate plan is submitted and compiled into a contract through the same deterministic pipeline the
  dashboard uses — never a second, weaker authorization path for API-driven callers.
- The contract either activates automatically (if allow-listed) or waits for one human click, never silently —
  and allow-listing it never grants anything beyond exactly this one tool, since the compiled contract's own
  allowed-actions list is always scoped to the plan's requested tools regardless of which registry permission
  the solver used to justify minimum coverage.
- The agent exchanges its runtime key for a short-lived session, fetches the contract-filtered tool manifest,
  and runs exactly one authorized call through the mandatory authorize → capability → execute sequence.
