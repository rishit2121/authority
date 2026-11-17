/**
 * Step 3 of the Setup page, "Use it in your code": the server `.env` block, one runnable sample for the chosen
 * connector, and a prompt a coding agent (Claude, Codex) can follow. Pure and isomorphic, unit-tested in
 * src/tests/unit/setup/handoff.test.ts.
 *
 * Only `envBlock` ever contains a key. The sample and the prompt are built from the same context object but never
 * read `env`: they name the variables, and the developer's own server fills them in.
 */

import { envFileText, installCommand, type SetupEnv } from "./quick-setup";
import { READ_CALLS, type ReadCall } from "./state";

export const ENV_KEY_NAMES = [
  "AUTHORITY_URL",
  "AUTHORITY_BACKEND_API_KEY",
  "AUTHORITY_AGENT_ID",
  "AUTHORITY_AGENT_RUNTIME_KEY",
] as const;

export const KEY_PLACEHOLDER = "<shown once at creation>";
export const SAMPLE_FILE = "first-call.mjs";
export const SAMPLE_RUN_COMMAND = `node --env-file=.env ${SAMPLE_FILE}`;
export const QUICKSTART_DOCS_PATH = "/docs/quickstart";

export interface HandoffContext {
  baseUrl: string;
  call: ReadCall;
  connectionId: string;
  /** The keys from this page's response, when it just made them. Accepted so callers can pass one context, and
   *  deliberately ignored: the sample and the prompt name variables, never values. */
  env?: SetupEnv | null;
}

/** `GMAIL_CONNECTION_ID`, `SLACK_CONNECTION_ID`, `NOTION_CONNECTION_ID`, ... */
export function connectionEnvVar(connectorId: string): string {
  const fixed = connectorId === "gmail" || connectorId === "slack" ? READ_CALLS[connectorId].envVar : null;
  return fixed ?? `${connectorId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CONNECTION_ID`;
}

/**
 * The server `.env`: the four Authority variables plus the connection id (which is not a secret). Keys come from
 * `env` when this page just issued them, and are placeholders otherwise.
 */
export function envBlock(context: {
  baseUrl: string;
  connectorId: string;
  connectionId: string;
  env?: SetupEnv | null;
}): string {
  const env: SetupEnv = context.env ?? {
    AUTHORITY_URL: context.baseUrl,
    AUTHORITY_BACKEND_API_KEY: KEY_PLACEHOLDER,
    AUTHORITY_AGENT_ID: KEY_PLACEHOLDER,
    AUTHORITY_AGENT_RUNTIME_KEY: KEY_PLACEHOLDER,
  };
  return `${envFileText(env)}${connectionEnvVar(context.connectorId)}=${context.connectionId}\n`;
}

/** One runnable server-side sample (plain JavaScript, no TypeScript to strip) for the chosen connector. */
export function firstCallSample(context: HandoffContext): string {
  const { call } = context;
  return `// ${SAMPLE_FILE}: run on your server only (${SAMPLE_RUN_COMMAND}).
import { Authority } from "@authority/sdk";

const authority = new Authority({
  baseUrl: process.env.AUTHORITY_URL,
  backendKey: process.env.AUTHORITY_BACKEND_API_KEY,
  agentId: process.env.AUTHORITY_AGENT_ID,
  runtimeKey: process.env.AUTHORITY_AGENT_RUNTIME_KEY,
});

// Use your own app's stable id for the signed-in user here (from your session or database, not an email).
// That user needs access to this connection: Setup shared it with your test customer only.
const userId = "your-user-id";

const run = await authority.prepareTask({
  userId,
  request: ${JSON.stringify(call.request)},
  connections: { ${call.connectorId}: process.env.${call.envVar} },
  actions: [{ tool: ${JSON.stringify(call.tool)}, expectedSideEffect: "read", maxInvocations: 1 }],
});

if (run.status !== "ready") {
  // partial | awaiting_approval | alignment_review | clarification | rejected | ai_unavailable
  console.log("Task not ready:", run.status);
  process.exit(1);
}

// Pick idempotency keys from your own event ids, so a retried request never becomes a second action.
const result = await run.task.call(${JSON.stringify(call.tool)}, {}, { idempotencyKey: "first-call-1" });
switch (result.status) {
  case "executed":
    console.log("Executed. Receipt:", result.receiptId);
    break;
  case "result_held":
    // It ran; only the result is withheld for review. Never run it again.
    console.log("Ran; result held for review. Receipt:", result.receiptId);
    break;
  case "indeterminate":
    // It MAY have run. Never retry automatically: check the receipt or the provider first.
    console.log("Outcome unknown, not retried:", result.message);
    break;
  default:
    // denied, requires_approval, requires_clarification, already_authorized, execution_failed, ...
    console.log("Not executed:", result.status, result.summary ?? "");
}
await run.task.close();
`;
}

/** A prompt for a coding agent. Variable NAMES only: no key, no agent id, no customer id. */
export function setupPrompt(context: HandoffContext): string {
  const { call } = context;
  const docs = `${context.baseUrl}${QUICKSTART_DOCS_PATH}`;
  return `Goal: add a server-side call through Authority to my app. When a signed-in user asks for it, my backend should run "${call.tool}" (read-only) for that user through Authority, and handle every outcome.

Environment variables (already set on the server; never print, log or commit their values):
${[...ENV_KEY_NAMES, call.envVar].map((name) => `- ${name}`).join("\n")}
${call.envVar} is ${context.connectionId} (a connection id, not a secret).

Install the SDK:
${installCommand(context.baseUrl)}

The SDK shape:
- const authority = new Authority({ baseUrl, backendKey, agentId, runtimeKey }) from "@authority/sdk", each read from the variables above.
- const run = await authority.prepareTask({ userId, request, connections: { ${call.connectorId}: process.env.${call.envVar} }, actions: [{ tool: "${call.tool}", expectedSideEffect: "read", maxInvocations: 1 }] })
- run.status is one of: ready, partial, awaiting_approval, alignment_review, clarification, rejected, ai_unavailable. Only "ready" has run.task.
- const result = await run.task.call("${call.tool}", {}, { idempotencyKey }) and result.status is one of: executed, result_held, denied, requires_approval, requires_clarification, requires_replan, held_for_review, already_authorized, execution_failed, indeterminate, in_progress, session_expired, stale_session, cancelled.
- Close the task when done: await run.task.close().

Rules:
- Server-side only. Never put any Authority key in browser code, a client bundle, logs, or model/tool arguments.
- userId is my app's own stable id for the user (not an email). A user only gets connections an admin shared with them.
- Choose idempotency keys from my own event or request ids, so a retry of the same request is the same action.
- Handle every status above explicitly. Never auto-retry "indeterminate" or "result_held": it may already have run.
- Pin targets (channel, recipient, record id) in the action's \`arguments\`; leave only free text (a message body) in \`agentGenerated\`.

Docs: ${docs}
`;
}
