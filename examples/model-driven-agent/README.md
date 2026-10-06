# Model-driven agent example

A real model picks which tool to call from the exact filtered manifest `AuthorityAgentClient.tools.list()`
returns, and the call is routed entirely through `@authority/sdk`. Demonstrates the one property that matters
most about tool-list filtering: it's convenience and exposure reduction, **not** the actual security boundary.
Runtime authorization is mandatory for every call, regardless of what the model was shown.

## What it proves

1. **Allowed call**: the model is given only `gmail.list_labels` (this task's active contract allows nothing
   else) and picks it; it executes successfully through `authorize()` → capability → `execute()`.
2. **Out-of-scope call, denied before dispatch**: the script then itself attempts `gmail.send_email` — a tool
   never offered to the model and not in this contract's allowed actions. Authority refuses it at `authorize()`
   time, before any connector runs. No email is sent. The example never implements a fallback that would let
   this through; it only ever calls `tools.execute()` and reports exactly what comes back.

## One-time setup

1. Run `examples/connector-quickstart --connector=gmail` first if you don't already have a connected Gmail
   customer — this example reuses that connection rather than opening a new one.
2. From the repo root: `npm install && npm run sdk:build`
3. `cp .env.example .env.local` here and fill in the Authority section (same credentials as the quickstart) and
   `CUSTOMER_ID` (the customer id the quickstart printed).

### Model credentials (separate from Authority)

`OPENAI_API_KEY` is a real OpenAI key, used only by this script to ask a model which tool to call — it is never
sent to Authority in any request, and Authority's own credentials are never sent to OpenAI. **Without this key,
the script runs in manual mode instead**: it makes the exact same two tool calls a model would have, with no
model call at all, so both demonstrations above run with zero model credentials.

## Run

```
npm start
```

The task's contract may need one human activation the first time (see the printed link) — exactly the same
behavior as the quickstart, for the same reason (`gmail.list_labels`'s own dedicated permission makes it
_eligible_ for automatic activation once allow-listed, but doesn't require it).
