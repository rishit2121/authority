# Ten-minute quickstart

Goal: see Authority contain attacks, then put one of your own agents behind it. Each part stands alone.

## 0. Prerequisites (2 min)

- Node 22, and a Supabase project with this repo's migrations applied (`npx supabase db push --linked`).
- `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `GATEWAY_DATABASE_URL`
  (create the restricted login with `npm run gateway:provision`). Nothing else is needed. For local demos add
  `GITHUB_EXECUTION_MODE=mock` so GitHub tools run against the in-memory mock, never the real GitHub.
- `npm ci && npm run dev`, then open http://localhost:3000 and sign up. On Render, skip this and use your deployed URL
  (`docs/deploy/RENDER.md`).

## 1. Attack your own controls (3 min, no agent needed)

1. **Validation Lab -> Environments -> Create environment.**
2. **Campaign builder -> Starter pack -> Start campaign.** It runs 28 attack scenarios against the real gateway in throwaway
   sandbox tenants (about a minute). Every scenario should pass: each attack was contained.
3. Open the run. Click a step to see expected vs actual, the control that answered, and the blast radius.
4. Now run **Hardening gaps** (a deliberately weakened configuration). Open **Findings**, then **Remediations**, accept the
   "Pin the ... argument" proposal, and watch the verification run pass. A regression test now guards that fix
   (**Regression history**).

Everything here is synthetic: fake tenants, mock integrations, a rule-based mock semantic provider. It does not touch your
data, real integrations, or the internet.

## 2. Put an agent behind Authority (5 min)

1. **Overview -> install the demo workspace** (or create your own agent/principal). It creates an agent, a task and a contract.
2. **Agents -> your agent -> Runtime credentials -> Issue credential.** Copy the `authority_rk_...` key now; it is shown once.
3. **Tasks -> New task** states the objective and the candidate plan. Authority compiles the **minimum authority** for that plan
   into a contract. Review it, then activate it. Nothing can run without an active contract.
4. Ask for permission from your agent (or curl). This example uses a simulated tool, so nothing external happens:

   ```bash
   curl -sS -X POST "$AUTHORITY_URL/api/v1/authorize" \
     -H "authorization: Bearer $AUTHORITY_RUNTIME_KEY" -H "content-type: application/json" \
     -d '{"taskId":"'$TASK_ID'","tool":"gmail.send_email","operation":"send_email",
          "arguments":{"to":"maya@example.com","subject":"Receipt","body":"Attached."},
          "idempotencyKey":"first-call-1"}'
   ```

   A `status` of `allow` returns a single-use capability token. Any argument outside the plan (a different recipient) returns
   `deny` or `replan` plus `guidance` telling the agent what to do next, without revealing thresholds or policy text.

5. Use the dependency-free client in `examples/agent/`:

   ```bash
   AUTHORITY_URL=... AUTHORITY_RUNTIME_KEY=... AUTHORITY_TASK_ID=... AUTHORITY_REPOSITORY=owner/repo \
     node examples/agent/sample-agent.mjs 1
   ```

   It calls `authority.call({...})`, which authorizes and (for `github.*` tools) executes through Authority's connector, and
   returns one of `done | wait_for_approval | replan | clarify | retry_later | stop`. Your agent follows that instead of guessing.

6. **Runtime** shows every decision (deterministic, semantic and final) and the capability lifecycle.

## 3. Gate your pull requests (optional, 2 min)

Copy `.github/workflows/ci.yml`'s `scenario-packs` job. It starts a throwaway local Supabase, runs the starter pack, and fails the
PR if any attack that was contained in `validation/baseline.starter.json` is no longer contained. See `docs/validation/CI.md`.

## Where next

`docs/validation/OVERVIEW.md` (how the lab works and what it can and cannot tell you) - `docs/api/RUNTIME_API.md` - `docs/github/SETUP.md`
(connect real GitHub) - `docs/ops/OPERATIONS.md` (health, maintenance, retention) - `docs/deploy/RENDER.md`.
