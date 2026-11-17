# Quickstart

From a clone to your own agent making one bounded call. Every command here is the same one the website and the dashboard show.

## 1. See it work: the Proof Run

You need Node 22 and Docker. From a clone:

```bash
git clone https://github.com/rishit2121/authority.git
cd authority && npm ci
npx supabase start
npm run authority -- demo
```

This runs one task, "Post one update in #engineering. Don't email anyone.", through a real local Authority. It creates the task, prepares it, opens a session, then authorizes and executes each attempt against a mock Slack transport. The output shows four attempts:

- Post to #engineering: allowed, executed once, with a receipt.
- Post to #general: blocked before dispatch (`CONSTRAINT_VIOLATION`). The channel is pinned.
- Post again to #engineering: blocked before dispatch (`INVOCATION_LIMIT_REACHED`). The task allows one post. A new idempotency key is a new attempt, not a retry.
- Send an email: blocked before dispatch (`TOOL_NOT_IN_CONTRACT`).

The command exits non-zero when a block becomes an allow, a reason changes or the mock provider sees an unexpected request. Use it as a regression test: `npm run authority -- demo --recipe examples/proof-run/engineering-update.json`. See [examples/proof-run](../examples/proof-run/README.md) for what it does and doesn't prove.

## 2. Run the dashboard locally

The demo already gave the local gateway role its development login. If you skipped it:

```bash
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

Run `npm run dev`, then open http://localhost:3000. Sign in as `owner.a@authority.test`; the seeded fixture password is in `src/tests/local/local-env.ts`. No model key is needed: the default path uses a fixed plan, and model-based features stay off without one. `npm run authority -- doctor` checks this machine and never prints a secret. Stop with `npx supabase stop --no-backup`.

**Hosted.** Use a Supabase project with this repo's migrations applied (`npx supabase db push --linked`). Set `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `GATEWAY_DATABASE_URL`, and create the restricted login with `npm run gateway:provision`. On Render, use your deployed URL (`docs/deploy/RENDER.md`). Never run the test suites against a project that holds real data.

## 3. Set up your agent

Open **Setup** (`/app/setup`). New accounts land there. It has three steps:

1. **Connect a service.** Choose your app (you're asked when you have more than one), then one connection. Each connector shows what connecting means: Gmail is a Google account consent, Slack is a workspace bot token, GitHub is a GitHub App installation. Setup shows who can already use the connection and changes nothing on its own. To make a test call, an owner or admin shares it with a single test customer. Sharing with every customer of the app is a separate, explicit choice.
2. **Make a protected call.** One read-only call (Gmail labels or Slack channels) with a fixed one-step plan and no model. You see Authority's decision, the reason and the receipt.
3. **Use it in your code.** A server `.env` block (keys are shown once), one runnable file and a **Copy setup prompt** button for Claude or Codex. None of them contains a secret.

The same flow from your backend, with the SDK (`npm install <AUTHORITY_URL>/sdk/authority-sdk.tgz`):

```ts
import { Authority } from "@authority/sdk";

const authority = new Authority({
  baseUrl: process.env.AUTHORITY_URL!,
  backendKey: process.env.AUTHORITY_BACKEND_API_KEY!,
  agentId: process.env.AUTHORITY_AGENT_ID!,
  runtimeKey: process.env.AUTHORITY_AGENT_RUNTIME_KEY!,
});

const run = await authority.prepareTask({
  userId: user.id,
  request: "Post one engineering update",
  connections: { slack: process.env.SLACK_CONNECTION_ID! },
  actions: [
    {
      tool: "slack.post_message",
      arguments: { channel: "C0ENGINEERING" },
      agentGenerated: ["text"],
      maxInvocations: 1,
    },
  ],
});

if (run.status === "ready") {
  const result = await run.task.call(
    "slack.post_message",
    { text: "The deployment is complete." },
    { idempotencyKey: event.id },
  );
}
```

- `prepareTask` resolves your user as an Authority customer, creates the task with exactly the connections you name, prepares the plan and opens a session for that one task. It never picks a different connection for you.
- `run.status` is `ready` only when every action was accepted. Approval, alignment review, clarification and a partially accepted plan each come back as their own status. Nothing is re-prepared or widened automatically.
- `run.task` is bound to this one task. Opening another task gives another handle and never changes this one.
- `call` takes the open inputs from the model (here, `text`) and uses the pinned values from the task. A conflicting value you pass is sent as is and refused, not rewritten. If the provider's answer is lost after the call was sent, the result is `indeterminate`: it may have run, and it is not retried.

For a starter project with this code, run this from the clone:

```bash
npm run authority -- init --dir ../my-agent
```

`init` previews the files and writes nothing until you add `--yes`. It never overwrites a file or installs anything globally.

Budgets count calls, not money. `maxInvocations` is how many times one action may run in one task. It spans re-preparations of the task: re-preparing does not reset it, and `raiseBudgets: true` from your backend is the only way to allow more. There is no dollar amount or limit across tasks.

For the raw HTTP version of each step, see [docs/api/RUNTIME_API.md](api/RUNTIME_API.md) or `/docs/http-walkthrough`.

## 4. Let the agent write a message after it reads data

**Short answer.** Yes, an agent can write a Slack message, including after reading data. Your backend does not pin
the text. It pins **where** the message goes and marks the text as written by the agent (`agentGenerated`).
Authority then leaves the text open and checks everything else.

Your backend creates the task (`POST /api/v1/customers/{customerId}/tasks`), then prepares it with its backend key
(`authority_dk_...`):

```bash
curl -sS -X POST "$AUTHORITY_URL/api/v1/tasks/$TASK_ID/prepare" \
  -H "authorization: Bearer $AUTHORITY_BACKEND_KEY" -H "content-type: application/json" \
  -d '{"plan":{"schemaVersion":1,"taskId":"'$TASK_ID'","nodes":[
        {"id":"post-summary","sequence":1,"tool":"slack.post_message",
         "arguments":{"channel":"C-eng-updates"},"agentGenerated":["text"],
         "expectedSideEffect":"write_create"}]}}'
```

If the agent should also read through Authority (a Linear issue, say), add that step to the plan as usual. The
message step does not need to reference it.

The response has `"status":"ready"`. The agent writes its summary and asks to post it. It uses
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

| In the plan                                                                 | At runtime                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A free-text field (message text, email subject or body, issue title) pinned | Must match exactly                                                  |
| A free-text field listed in `agentGenerated`                                | Open: the agent writes it                                           |
| An optional free-text field left out (Gmail `body`, Linear `description`)   | Open: the agent writes it                                           |
| A required free-text field neither pinned nor listed (Slack `text`)         | Not allowed: prepare excludes the step (`clarify`)                  |
| A target or value (channel, recipient, id, path, branch, amount)            | Must be pinned. In `agentGenerated` it excludes the step (`replan`) |

A free-text field can also be bound to an earlier step's declared output with `dataFlowRefs`; it is then open in
the same way. That form still works, but Authority does not check where the text came from, so `agentGenerated`
says the same thing more honestly.

Two limits apply:

- **The text is not checked.** Open text can say anything; Authority pins targets and values, not content. Use
  content screening or task alignment if that matters to you; both are probabilistic.
- **The channel must be known before you prepare.** "Reply in whichever channel the message came from" is not
  supported. Resolve the channel in your backend, then prepare with it pinned.

## 5. Attack your own controls (optional, no agent needed)

1. **Validation Lab -> Environments -> Create environment.**
2. **Campaign builder -> Starter pack -> Start campaign.** It runs 28 attack scenarios against the real gateway in throwaway
   sandbox tenants (about a minute). Every scenario should pass: each attack was contained.
3. Open the run. Click a step to see expected vs actual, the control that answered, and the blast radius.
4. Now run **Hardening gaps** (a deliberately weakened configuration). Open **Findings**, then **Remediations**, accept the
   "Pin the ... argument" proposal, and watch the verification run pass. A regression test now guards that fix
   (**Regression history**).

Everything here is synthetic: fake tenants, mock integrations, a rule-based mock semantic provider. It does not touch your
data, real integrations, or the internet.

## 6. Gate your pull requests (optional)

Copy `.github/workflows/ci.yml`'s `scenario-packs` job. It starts a throwaway local Supabase, runs the starter pack, and fails the
PR if any attack that was contained in `validation/baseline.starter.json` is no longer contained. See `docs/validation/CI.md`.

## Where next

`docs/validation/OVERVIEW.md` (how the lab works and what it can and cannot tell you) - `docs/api/RUNTIME_API.md` - `docs/github/SETUP.md`
(connect real GitHub) - `docs/ops/OPERATIONS.md` (health, maintenance, retention) - `docs/deploy/RENDER.md`.
