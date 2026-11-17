# @authority/sdk

TypeScript client for [Authority](https://authority-d2zf.onrender.com): give your AI agent only the
access each task needs. Server-side only (Node 20+).

## Install

The package is not on the npm registry. Build a tarball from this repository:

```sh
npm pack -w @authority/sdk                 # writes authority-sdk-0.2.0.tgz
npm install ./authority-sdk-0.2.0.tgz      # in your app
```

Every Authority deployment also serves the SDK it was built with, at `/sdk/authority-sdk.tgz`:

```sh
npm install https://<your-authority-url>/sdk/authority-sdk.tgz
```

## Use

Create an agent on the **Setup** page of the Authority dashboard. It gives you four values: the deployment
URL, a backend key, the agent id and the agent's runtime key.

```ts
import { Authority } from "@authority/sdk";

const authority = new Authority({
  baseUrl: process.env.AUTHORITY_URL!,
  backendKey: process.env.AUTHORITY_BACKEND_API_KEY!,
  agentId: process.env.AUTHORITY_AGENT_ID!,
  runtimeKey: process.env.AUTHORITY_AGENT_RUNTIME_KEY!,
});

const run = await authority.prepareTask({
  userId: user.id, // your signed-in user
  request: "Post one engineering update",
  connections: { slack: process.env.SLACK_CONNECTION_ID! }, // which connection YOUR app chose
  actions: [
    {
      tool: "slack.post_message",
      arguments: { channel: "C0ENGINEERING" }, // pinned: the model cannot change it
      agentGenerated: ["text"], // the only thing the agent writes
      maxInvocations: 1,
    },
  ],
});

if (run.status === "ready") {
  const result = await run.task.call(
    "slack.post_message",
    { text: "The deployment is complete." },
    { idempotencyKey: event.id }, // required: one stable key per action
  );
}
```

A runnable version is in `examples/sdk-quickstart` (`index.ts`, and `openai-agent.ts` for tool calling).

### How the pieces fit

Your app authenticates the person; Authority never sees their login. Authority holds the provider connection
(the Slack bot token, the Gmail grant) — your app only names which connection a task may use. `prepareTask`
turns one trusted request into a contract, and the server binds a short-lived **task session** to that one
task: its token works for that task only, and a call outside the contract is refused there, whatever the
client sends. Adapters only map the task's allowed actions to a framework's tool schema and route calls back
to the task handle. Secrets never appear in model arguments, tool schemas or tool results: the model writes
only the open inputs (the message text), and pinned values come from the contract.

- `prepareTask` validates everything first (`AuthorityConfigError`, before any request): every action's
  provider needs an entry in `connections` (GitHub tools take `githubRepositoryId` instead), and a tool the
  SDK does not know needs `expectedSideEffect`. The SDK never picks a connection for you.
- `idempotencyKey` on `prepareTask` defaults to a hash of the agent, user, request, connections and actions,
  so the same request resolves to the same task. Pass your own key per logical run when the same request may
  be made again later.
- `raiseBudgets: true` renews task-wide budgets when the contract activates. It is never set for you.

### prepareTask outcomes

| `status`            | Meaning                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `ready`             | The whole plan is active; `run.task` is an open handle.                                    |
| `partial`           | Active, but `excludedSteps` were left out. No session; fix the plan or `openTask(taskId)`. |
| `awaiting_approval` | A person must activate it at `approvalPath`; then `authority.openTask(taskId)`.            |
| `alignment_review`  | Alignment review did not clear it: `decision` is `revise` or `hold`; see `reviewPath`.     |
| `clarification`     | The plan cannot be compiled as given (`reason`, `details`).                                |
| `rejected`          | Refused (`reason`).                                                                        |
| `ai_unavailable`    | A required review could not run. Try again later.                                          |

Nothing is re-prepared, widened or approved automatically. `allowPartial: true` accepts a partial contract.

### task.call results

Every expected outcome is a value; only a request that could not be made at all throws `AuthorityApiError`
(`status`, `code`, `requestId`). Nothing is retried. Each result carries `requestIds`, `decisionId`,
`reasonCodes`, `summary` and `guidance`.

| `status`                 | Meaning                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `executed`               | Done: `receiptId`, `data`, and `delivery` / `inspection` when screening ran.               |
| `result_held`            | Done, but the result is held for review. Do not repeat it.                                 |
| `denied`                 | Outside the contract (`reasonCodes`).                                                      |
| `requires_approval`      | A person must approve (`approvalId`, `statusUrl`); then repeat with the same key.          |
| `requires_clarification` | Arguments are missing or ambiguous.                                                        |
| `requires_replan`        | This call does not fit the task; plan again.                                               |
| `held_for_review`        | Task alignment needs a person; repeat with the same key once approved.                     |
| `already_authorized`     | This key already got its capability; the earlier call may have run. Not repeated.          |
| `execution_failed`       | The execute step was refused or failed before the provider acted. Nothing was written.     |
| `indeterminate`          | Execute was sent and the outcome is unknown: the write **may** have happened. Check first. |
| `in_progress`            | Another request with this key is executing.                                                |
| `session_expired`        | Expired, revoked or closed. Open a new handle with `authority.openTask(taskId)`.           |
| `stale_session`          | The contract changed or is no longer active. Open a new handle.                            |
| `cancelled`              | Your signal or a timeout stopped it before execute was sent. Nothing was written.          |

Arguments pinned by the contract are filled in for keys you leave out. A key you supply is sent as given —
if it differs from the pin, the server refuses it. `task.context()` lists, per allowed action, what is pinned,
what is open and the remaining budget; `task.tools()` returns the raw manifest.

Handles are immutable and independent: each holds its own session token (never in `JSON.stringify(task)`),
and opening task B never changes task A. `task.close()` revokes the session.

### OpenAI tool calling

```ts
import { handleOpenAIToolCall, toOpenAITools } from "@authority/sdk/openai";

const tools = await toOpenAITools(run.task); // only open inputs; pinned keys are omitted
// ... pass `tools` to the model, then for each tool call it returns:
const output = await handleOpenAIToolCall(run.task, toolCall, { idempotencyKey: `${runId}:${toolCall.id}` });
// `output` is a JSON string for the model: status and safe text, never a token
```

No dependency on the `openai` package. Tool names map `slack.post_message` to `slack__post_message`.

### MCP

A task is also reachable over MCP at its own task-bound URL, `/api/mcp/tasks/{taskId}`, with the headers
`Authorization: Bearer <session token>` and `Accept: application/json, text/event-stream`. `task.mcp()`
returns both; the result contains the session token, so treat it as a secret. This works only with MCP
clients that let you set that header — there is no OAuth or click-to-connect flow for it.

## Low-level clients

`authority.backend` is the `AuthorityBackendClient` (customers, connections, tasks, contracts), and
`authority.lowLevel.createAgentClient()` returns a new `AuthorityAgentClient`. Both are unchanged from 0.1.
Note that `AuthorityAgentClient.sessions.create` replaces that instance's own token with the session token,
so one instance serves one task; the `Authority` facade never shares or mutates a credential.

Full docs: `/docs/quickstart` on your Authority deployment.
