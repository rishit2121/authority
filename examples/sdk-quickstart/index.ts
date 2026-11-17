/**
 * The smallest complete Authority integration: one trusted request from your signed-in user becomes one task that
 * can post exactly one Slack message to exactly one channel.
 *
 *   cp .env.example .env      # fill in from the dashboard's Setup page
 *   npm run start             # from this directory (repo root: npm install && npm run sdk:build first)
 */
import { Authority } from "@authority/sdk";

import { describeCall, describePrepare } from "./outcomes";

// Placeholders for what your app already has: the authenticated user, and the event this action answers.
const user = { id: process.env.AUTHORITY_USER_ID ?? "user-123" };
const event = { id: process.env.EVENT_ID ?? `deploy-${new Date().toISOString().slice(0, 10)}` };

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
console.log(describePrepare(run, process.env.AUTHORITY_URL!));

if (run.status === "ready") {
  const result = await run.task.call(
    "slack.post_message",
    { text: "The deployment is complete." },
    { idempotencyKey: event.id },
  );
  console.log(describeCall(result));
  await run.task.close("quickstart finished");
}
