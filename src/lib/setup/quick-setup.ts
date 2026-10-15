import type { ToolOperation } from "@/lib/registry/types";

/**
 * Pure helpers behind the dashboard's one-page Setup flow
 * (src/app/app/setup). Kept free of database and server-only imports so the
 * client component can render the same snippet the server computed, and so
 * every rule here is unit-testable on its own.
 */

/** Connector id -> the tool-name provider prefix it owns (identical today, kept explicit). */
function providerOf(tool: string): string {
  return tool.slice(0, tool.indexOf("."));
}

/**
 * Which tools quick setup may allow-list for automatic activation: only
 * plain reads, under exactly the connectors the admin selected. Anything
 * that writes, sends data outside the organization, moves money, or touches
 * secret-classified data is never auto-run -- it still waits for a human
 * approval in the dashboard. Allow-listing is never a grant on its own:
 * `gateway.activate_task_contract_for_backend` still refuses to activate a
 * contract whose own freshly-derived approval requirement is non-empty.
 */
export function autoRunnableReadTools(
  operations: Iterable<ToolOperation>,
  connectorIds: readonly string[],
): string[] {
  const wanted = new Set(connectorIds);
  const tools: string[] = [];
  for (const op of operations) {
    if (!wanted.has(providerOf(op.id))) continue;
    if (op.sideEffect !== "read") continue;
    if (op.externalCommunication || op.financialImpact || op.requiresApproval) continue;
    if (op.dataSensitivity === "secret") continue;
    tools.push(op.id);
  }
  return tools.sort();
}

export interface SetupEnv {
  AUTHORITY_URL: string;
  AUTHORITY_BACKEND_API_KEY: string;
  AUTHORITY_AGENT_ID: string;
  AUTHORITY_AGENT_RUNTIME_KEY: string;
}

export function envFileText(env: SetupEnv): string {
  return [
    `AUTHORITY_URL=${env.AUTHORITY_URL}`,
    `AUTHORITY_BACKEND_API_KEY=${env.AUTHORITY_BACKEND_API_KEY}`,
    `AUTHORITY_AGENT_ID=${env.AUTHORITY_AGENT_ID}`,
    `AUTHORITY_AGENT_RUNTIME_KEY=${env.AUTHORITY_AGENT_RUNTIME_KEY}`,
    "",
  ].join("\n");
}

/** A first task per connector that needs no ids the developer doesn't have yet. */
const EXAMPLE_INTENTS: Record<string, string> = {
  slack: "List the channels in our Slack workspace",
  gmail: "List the labels in my Gmail inbox",
  linear: "List the open issues on our Linear team",
  notion: "Read the pages in our Notion database",
  stripe: "Look up a Stripe customer",
  github: "Read issue #1 in our repository",
};

export function exampleIntentFor(connectorIds: readonly string[]): string {
  for (const id of connectorIds) {
    const intent = EXAMPLE_INTENTS[id];
    if (intent) return intent;
  }
  return "Describe what this task should do, in plain English";
}

export function installCommand(baseUrl: string): string {
  return `npm install ${baseUrl}/sdk/authority-sdk.tgz`;
}

export const RUN_COMMAND = "node --env-file=.env quickstart.mjs";

export function quickstartSnippet(intent: string): string {
  return `import { AuthorityBackendClient, AuthorityAgentClient } from "@authority/sdk";

const url = process.env.AUTHORITY_URL;
const backend = new AuthorityBackendClient({ baseUrl: url, apiKey: process.env.AUTHORITY_BACKEND_API_KEY });
const agent = new AuthorityAgentClient({ baseUrl: url, token: process.env.AUTHORITY_AGENT_RUNTIME_KEY });

// 1. Who the task is for -- any stable id from your own app.
const { customerId } = await backend.customers.ensure({ externalId: "user-123" });

// 2. Describe the task. Authority drafts the plan and grants only what it needs.
const { connections } = await backend.connections.list(customerId);
const { taskId } = await backend.tasks.create({
  customerId,
  agentId: process.env.AUTHORITY_AGENT_ID,
  intent: ${JSON.stringify(intent)},
  connections: connections.map(({ connectorId, connectionId }) => ({ connectorId, connectionId })),
});
const prepared = await backend.tasks.prepare(taskId, { generate: true });
if (prepared.status !== "ready") {
  console.log(prepared.status, "-- approve it on the Approvals page, then run this again.");
  process.exit(0);
}

// 3. Hand your agent a session for this one task: it can't reach any other task,
//    including other users' -- and sees, and can call, only the tools it was granted.
await agent.sessions.create({ taskId });
const { tools } = await agent.tools.list(taskId);
console.log("granted:", tools.map((t) => t.tool));

// 4. Call them. The arguments Authority pinned for this task come with each tool.
for (const t of tools) {
  const args = {};
  for (const { key, equals } of t.resourceConstraints) {
    const type = t.inputSchema.properties?.[key]?.type;
    args[key] = type === "number" ? Number(equals) : type === "boolean" ? equals === "true" : equals;
  }
  const result = await agent.tools.execute({ taskId, tool: t.tool, arguments: args });
  console.log(t.tool, "->", result.status, JSON.stringify(result.data ?? result.summary ?? "").slice(0, 500));
}
`;
}
