# Setting up Jev (OpenRouter)

See `docs/jev/OVERVIEW.md` first for what Jev does and does not do, the verified API facts, and current
limitations. This document is the operational how-to.

## Environment variables

| Variable                                        | Where                                                       | Notes                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`                            | server only (Render env var, or `.env.local` for local dev) | Never `NEXT_PUBLIC_`-prefixed. Never commit it.                                                                                                                                                                                             |
| `OPENROUTER_BASE_URL`                           | server, optional                                            | Defaults to `https://openrouter.ai/api/v1`.                                                                                                                                                                                                 |
| `OPENROUTER_PLAN_MODEL`                         | server, optional                                            | Defaults to `typesafe/jev-router`.                                                                                                                                                                                                          |
| `OPENROUTER_JEV_DECISION_MODEL`                 | server, required for Roles B & C                            | No default — set this to the exact verified direct-Jev decision model slug (see `docs/jev/OVERVIEW.md`'s verified-facts table; re-check OpenRouter's current listing before setting this, as slugs and versions are not guaranteed stable). |
| `OPENROUTER_HTTP_REFERER`, `OPENROUTER_X_TITLE` | server, optional                                            | OpenRouter dashboard attribution only.                                                                                                                                                                                                      |
| `OPENROUTER_DENY_DATA_COLLECTION`               | server, optional                                            | `1` to send `provider: { data_collection: "deny" }`.                                                                                                                                                                                        |
| `OPENROUTER_ZDR_ONLY`                           | server, optional                                            | `1` to restrict routing to zero-data-retention providers.                                                                                                                                                                                   |

## What you can do right now, without a key

Everything in this repository except a real, authenticated OpenRouter call already works and is tested:

```bash
npm run typecheck
npm run lint
npm test                 # unit tests, including every Jev unit test, all against mocks or unauthenticated probes
npm run jev:eval         # regenerates docs/jev/EVALUATION_RESULTS.md against the mock providers
npm run test:jev-live    # will report "skipped" — this is expected and correct without a key
```

Settings UI, contract-proposal UI and the runtime dashboard's Jev column all render correctly with Jev
unconfigured — they show "not configured" / "not evaluated" rather than errors.

## Steps once `OPENROUTER_API_KEY` is available

1. **Create an OpenRouter API key.** Log into OpenRouter, create a new key scoped to this project, and note it
   somewhere secret (a password manager) — not in a file that will be committed.
2. **Put it in Render** as `OPENROUTER_API_KEY` on this service's environment variables (never in a repo file,
   never in a client-visible config, never logged).
3. **Confirm the exact direct Jev decision model slug** against OpenRouter's current model listing (the table in
   `docs/jev/OVERVIEW.md` was correct as of 2026-09-29 but is a point-in-time record, not a guarantee) and set
   `OPENROUTER_JEV_DECISION_MODEL` in Render to that exact slug.
4. **Select `typesafe/jev-router` for plan proposals** by leaving `OPENROUTER_PLAN_MODEL` unset (it is already the
   default) — or set it explicitly if you want to pin a different router-compatible model.
5. **Redeploy** the service so the new environment variables take effect.
6. **Run one real plan-generation test**: as a signed-in user with a task, click "Generate plan with AI" on
   `/app/tasks/<taskId>/contract/new` (with `OPENAI_API_KEY` unset, so OpenRouter is selected). Confirm the UI shows
   "Generated by openrouter (requested model: typesafe/jev-router...)" and, if OpenRouter routed to a different
   underlying model, the "actually routed to" text.
7. **Verify every proposed tool received a necessity evaluation**: set the tenant's Jev necessity mode to `shadow`
   in Settings, propose a contract from a real or AI-generated plan, and confirm the contract-proposal page's
   "Jev tool-necessity evaluation" table shows a row with a real classification/confidence for every node (not
   "unavailable").
8. **Run a real runtime risk evaluation in shadow mode**: set the tenant's Jev risk mode to `shadow` in Settings,
   activate a contract, and make one authorized tool call through `POST /api/v1/authorize`. Confirm
   `/app/runtime`'s "Jev risk (shadow)" column shows a real risk class/confidence/provider/latency for that
   decision (not "not evaluated").
9. **Verify the actual routed provider/model**: check the persisted `provider`/`model` values shown in the UI (or
   query `jev_necessity_evaluations` / `jev_risk_evaluations` directly) match what you expect — OpenRouter's own
   routing can differ from the requested slug even for the direct Decisions API in principle, so confirm rather
   than assume.
10. **Monitor usage and spending** on OpenRouter's dashboard for the first several hours/days of real traffic
    before enabling this for all tenants — necessity and risk evaluation run once per plan node / once per
    authorized call respectively, so volume scales with authorization traffic, not with human page views.

**Do not enable `enforce` mode for necessity, and do not attempt to enable any risk enforcement (there is currently
no schema value for it — see `docs/jev/OVERVIEW.md`), until the live-test steps above have been run and the
evaluation harness (`npm run jev:eval`, pointed at the real provider — see below) has been reviewed by a human.**

## Running the evaluation harness against a real model

`src/lib/jev/eval/run-eval.ts`'s `evaluateNecessityCorpus` / `evaluateRiskCorpus` both accept an optional provider
argument, defaulting to the mock. Once a key and decision model are configured, pass a real provider instance to
measure actual model behavior on the same labeled corpus used for the mock regression floors:

```ts
import { OpenRouterJevNecessityProvider } from "@/lib/jev/openrouter-necessity-provider";
import { evaluateNecessityCorpus, necessityMetrics } from "@/lib/jev/eval/run-eval";

const results = await evaluateNecessityCorpus(new OpenRouterJevNecessityProvider());
console.log(necessityMetrics(results));
```

This corpus is small (7 necessity cases, 5 risk cases) and was written to exercise the combination-rule logic, not
to be a statistically powered accuracy benchmark — treat any resulting percentages as a starting sanity check, not
a calibration result, and grow the corpus with real, tenant-reviewed cases before relying on a specific threshold.

## Running the live smoke test

```bash
OPENROUTER_API_KEY=... OPENROUTER_JEV_DECISION_MODEL=... JEV_LIVE_SMOKE=1 npm run test:jev-live
```

This makes four real, billed API calls (one each: necessity, risk, completeness, plan-router) and asserts only on
_shape_ (valid classification, confidence in [0,1], every returned identifier is one Authority actually offered as a
candidate) — never on Jev's specific judgment for these inputs. It is the only place in this codebase where a
result may be described as a verified **live** Jev response; every other test uses a mock.

## Regenerating `database.types.ts` (needed for full type safety on the new tables)

The three new tables (`jev_settings`, `jev_necessity_evaluations`, `jev_plan_completeness_evaluations`,
`jev_risk_evaluations`) are currently accessed through a documented `as unknown as` cast at the RPC/table-name
boundary (see `src/lib/jev/persistence.ts`'s module doc) because this environment's `SUPABASE_ACCESS_TOKEN` is
expired. Once refreshed:

```bash
npm run db:types
```

and every cast in `src/lib/jev/persistence.ts` and `src/app/app/runtime/page.tsx` can be deleted with no behavior
change — search for "TEMPORARY" in those files.
