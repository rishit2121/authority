# Ten-minute quickstart

Goal: see Authority contain attacks, then put one of your own agents behind it. Each part stands alone.

## 0. Prerequisites (2 min)

**Local, no cloud account (recommended to start).** Node 22 and Docker. These are the steps CI runs on every pull
request, against a throwaway database:

```bash
npm ci
npx supabase start            # local Postgres + Auth; applies supabase/migrations and supabase/seed.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "alter role authority_gateway with login password 'ci-only-gateway-password'"
```

`.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY from `npx supabase status -o env`>
GATEWAY_DATABASE_URL=postgresql://authority_gateway:ci-only-gateway-password@127.0.0.1:54322/postgres
GATEWAY_DATABASE_SSL=disable
AUTHORITY_DEPLOYMENT=local
GITHUB_EXECUTION_MODE=mock
```

`npm run dev`, then open http://localhost:3000 and sign in as `owner.a@authority.test` (the seeded fixture password
is in `src/tests/local/local-env.ts`). No model key is needed; model-based features stay off without one. Stop with
`npx supabase stop --no-backup`.

**Hosted.** A Supabase project with this repo's migrations applied (`npx supabase db push --linked`), `.env.local`
with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `GATEWAY_DATABASE_URL` (create the
restricted login with `npm run gateway:provision`), and `GITHUB_EXECUTION_MODE=mock` for demos. On Render, use your
deployed URL (`docs/deploy/RENDER.md`). Never run the test suites against a project that holds real data.

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

   A `status` of `allow` returns a single-use capability token. Any argument outside the plan (a different recipient,
   or an argument the plan never set) returns `deny` or `replan` plus `guidance` telling the agent what to do next,
   without revealing thresholds or policy text. `gmail.send_email` communicates outside the organization, so its
   contract needs a person's approval before it activates.

5. Use the dependency-free client in `examples/agent/`:

   ```bash
   AUTHORITY_URL=... AUTHORITY_RUNTIME_KEY=... AUTHORITY_TASK_ID=... AUTHORITY_REPOSITORY=owner/repo \
     node examples/agent/sample-agent.mjs 1
   ```

   It calls `authority.call({...})`, which authorizes and (for `github.*` tools) executes through Authority's connector, and
   returns one of `done | wait_for_approval | replan | clarify | retry_later | stop`. Your agent follows that instead of guessing.

6. **Runtime** shows every decision (deterministic, semantic and final) and the capability lifecycle.

## 3. Let the agent write a message after it reads data

**Short answer.** Yes, an agent can compose a Slack message after reading data. Your backend does not pin the text.
It pins **where** the message goes and declares that the text comes from an earlier step. Authority then leaves the
text open and checks everything else.

Your backend creates the task (`POST /api/v1/customers/{customerId}/tasks`), then prepares it with its backend key
(`authority_dk_...`). This plan reads one Linear issue, then posts a summary that the agent writes:

```bash
curl -sS -X POST "$AUTHORITY_URL/api/v1/tasks/$TASK_ID/prepare" \
  -H "authorization: Bearer $AUTHORITY_BACKEND_KEY" -H "content-type: application/json" \
  -d '{"plan":{"schemaVersion":1,"taskId":"'$TASK_ID'","nodes":[
        {"id":"read-issue","sequence":1,"tool":"linear.get_issue",
         "arguments":{"issue_id":"ENG-42"},"declaredOutputs":["issue"],"expectedSideEffect":"read"},
        {"id":"post-summary","sequence":2,"tool":"slack.post_message",
         "arguments":{"channel":"C-eng-updates"},
         "dataFlowRefs":[{"argumentKey":"text","fromNodeId":"read-issue","output":"issue"}],
         "expectedSideEffect":"write_create"}]}}'
```

The response has `"status":"ready"`. The agent reads the issue, writes its own summary and asks to post it. It uses
a task session token from `POST /api/v1/sessions`, or its runtime key if your application does not require sessions:

```bash
curl -sS -X POST "$AUTHORITY_URL/api/v1/authorize" \
  -H "authorization: Bearer $AUTHORITY_SESSION_TOKEN" -H "content-type: application/json" \
  -d '{"taskId":"'$TASK_ID'","tool":"slack.post_message","operation":"post_message",
       "arguments":{"channel":"C-eng-updates","text":"ENG-42 is in review; fix expected Thursday."},
       "idempotencyKey":"summary-1"}'
```

That call is allowed, whatever text the agent wrote. The same call to `C-general` is denied, and so is a second post
once the step's budget (`maxInvocations`, default 1) is spent. Re-preparing the same plan does not reset that budget;
prepare with `raiseBudgets: true` when you mean to allow another post. `src/tests/local/real-api-evaluation.test.ts` runs
exactly this plan.

What each field may do:

| In the plan                                                                 | At runtime                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A free-text field (message text, email subject or body, issue title) pinned | Must match exactly                                               |
| A free-text field bound by `dataFlowRefs` to an earlier step's output       | Open: the agent writes it                                        |
| An optional free-text field left out (Gmail `body`, Linear `description`)   | Open: the agent writes it                                        |
| A required free-text field left out with no `dataFlowRefs` (Slack `text`)   | Not allowed: prepare excludes the step (`clarify`)               |
| A target or value (channel, recipient, id, path, branch, amount)            | Must be pinned. `dataFlowRefs` here excludes the step (`replan`) |

Two limits apply:

- **Authority does not check that the text came from that step.** The reference makes the open field explicit in the
  contract; it is not provenance. Open text can say anything, so use content screening if that matters to you.
- **The channel must be known before you prepare.** "Reply in whichever channel the message came from" is not
  supported. Resolve the channel in your backend, then prepare with it pinned.

## 4. Gate your pull requests (optional, 2 min)

Copy `.github/workflows/ci.yml`'s `scenario-packs` job. It starts a throwaway local Supabase, runs the starter pack, and fails the
PR if any attack that was contained in `validation/baseline.starter.json` is no longer contained. See `docs/validation/CI.md`.

## Where next

`docs/validation/OVERVIEW.md` (how the lab works and what it can and cannot tell you) - `docs/api/RUNTIME_API.md` - `docs/github/SETUP.md`
(connect real GitHub) - `docs/ops/OPERATIONS.md` (health, maintenance, retention) - `docs/deploy/RENDER.md`.
