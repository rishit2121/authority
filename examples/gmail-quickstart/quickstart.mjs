#!/usr/bin/env node
/**
 * The Gmail read-only quickstart: connect your own agent and run a real
 * bounded task from code, reusing the SAME customer/connection across runs
 * -- no dashboard visit per task, no hand-assembled API requests, no
 * manually copied tokens. The one interactive step (Google consent) only
 * happens the first time this customer has no Gmail connection yet; every
 * later run reuses it.
 *
 * Setup (one time):
 *   1. cp .env.example .env.local, fill in AUTHORITY_BACKEND_API_KEY,
 *      AUTHORITY_AGENT_ID, AUTHORITY_AGENT_RUNTIME_KEY (dashboard: Settings
 *      -> Applications, and Agents -- see .env.example's own comments).
 *   2. Register this script's fixed return URL on your application:
 *      http://127.0.0.1:4300/connected
 *   3. (Optional, for automatic activation without a dashboard click):
 *      Settings -> Applications -> (your application) -> Automation ->
 *      allow-list "gmail.list_labels". gmail.list_labels has its own
 *      dedicated registry permission (gmail.labels_read), disjoint from
 *      gmail.list_messages/get_message's permission, so allow-listing it
 *      can never grant message-reading access -- see
 *      src/lib/registry/fixtures/github-demo.ts's own comment on
 *      gmail.labels_read for exactly why. Without this step, the script
 *      still works end to end; it just stops at "awaiting_approval" the
 *      first time, until a human activates the proposed contract once from
 *      the dashboard.
 *
 * Run:
 *   npm install && npm run sdk:build   (from the repo root, once)
 *   npm start                          (from this directory, every time)
 *
 * This script never sends email -- the only tool call it ever makes is the
 * read-only gmail.list_labels.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AuthorityBackendClient, AuthorityAgentClient, AuthorityApiError } from "@authority/sdk";

const PORT = 4300;
const RETURN_URL = `http://127.0.0.1:${PORT}/connected`;
const HERE = path.dirname(fileURLToPath(import.meta.url));

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...readEnvFile(path.join(HERE, ".env.local")), ...process.env };

function requireEnv(name) {
  const value = env[name];
  if (!value) {
    console.error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in -- see that file's comments.`,
    );
    process.exit(1);
  }
  return value;
}

const AUTHORITY_URL = env.AUTHORITY_URL || "http://localhost:3000";
const BACKEND_API_KEY = requireEnv("AUTHORITY_BACKEND_API_KEY");
const AGENT_ID = requireEnv("AUTHORITY_AGENT_ID");
const AGENT_RUNTIME_KEY = requireEnv("AUTHORITY_AGENT_RUNTIME_KEY");
const CUSTOMER_EXTERNAL_ID = env.CUSTOMER_EXTERNAL_ID || "quickstart-customer";
// Set this to reuse an already-connected customer by id (e.g. one from an
// earlier live-test run) instead of resolving/creating one by external id --
// skips customers.ensure() entirely. Find it under Settings -> Applications
// -> (your application) -> Customers.
const CUSTOMER_ID = env.CUSTOMER_ID || null;

/** Never prints a token, a capability, or a raw error body -- only the already-sanitized fields an AuthorityApiError carries. */
function describeError(error) {
  if (error instanceof AuthorityApiError) {
    return `${error.code} (http ${error.status}${error.requestId ? `, request ${error.requestId}` : ""}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function waitForBrowserReturn() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (url.pathname !== "/connected") {
        res.writeHead(404).end();
        return;
      }
      res
        .writeHead(200, { "content-type": "text/html" })
        .end("<html><body>Connected. You can close this tab and return to the terminal.</body></html>");
      server.close();
      resolve(url.searchParams.get("connection_session_id"));
    });
    server.on("error", reject);
    server.listen(PORT);
  });
}

async function main() {
  const backend = new AuthorityBackendClient({ baseUrl: AUTHORITY_URL, apiKey: BACKEND_API_KEY });

  const customer = CUSTOMER_ID
    ? { customerId: CUSTOMER_ID, wasCreated: false }
    : await backend.customers.ensure({ externalId: CUSTOMER_EXTERNAL_ID });
  console.log(`Customer: ${customer.customerId}${customer.wasCreated ? " (just created)" : " (reused)"}`);

  const { connections } = await backend.connections.list(customer.customerId);
  let connection = connections.find((c) => c.connectorId === "gmail" && c.status === "active");

  if (!connection) {
    console.log("\nNo Gmail connection yet for this customer -- opening the one-time consent flow.");
    const session = await backend.connections.start({
      customerId: customer.customerId,
      connectorId: "gmail",
      returnUrl: RETURN_URL,
    });
    const url = new URL(session.url, AUTHORITY_URL).toString();
    console.log(`\nOpen this URL in a browser and complete Google consent:\n\n  ${url}\n`);
    await waitForBrowserReturn();
    const after = await backend.connections.list(customer.customerId);
    connection = after.connections.find((c) => c.connectorId === "gmail" && c.status === "active");
    if (!connection) {
      console.error("Consent did not result in an active Gmail connection. Try again.");
      process.exit(1);
    }
    console.log(`Connected: ${connection.verifiedAccountRef ?? connection.connectionId}`);
  } else {
    console.log(
      `Reusing existing Gmail connection: ${connection.verifiedAccountRef ?? connection.connectionId}`,
    );
  }

  // Idempotent on both id fields: re-running this script never creates a
  // second task or a second contract for the same customer.
  const task = await backend.tasks.create({
    customerId: customer.customerId,
    agentId: AGENT_ID,
    intent: "List my Gmail labels (quickstart)",
    connections: [{ connectorId: "gmail", connectionId: connection.connectionId }],
    idempotencyKey: `quickstart-task-${customer.customerId}`,
  });
  console.log(`Task: ${task.taskId}${task.wasCreated ? " (just created)" : ""}`);

  const outcome = await backend.tasks.prepare(
    task.taskId,
    {
      plan: {
        schemaVersion: 1,
        nodes: [
          {
            id: "list-labels",
            sequence: 0,
            tool: "gmail.list_labels",
            arguments: {},
            expectedSideEffect: "read",
          },
        ],
      },
    },
    `quickstart-prepare-${customer.customerId}`,
  );

  if (outcome.status === "awaiting_approval") {
    console.log(
      `\nContract ${outcome.contractId} is proposed but needs a human to activate it once:\n` +
        `  ${new URL(outcome.approvalPath, AUTHORITY_URL)}\n` +
        `(Or allow-list "gmail.list_labels" for this application under Settings -> Applications ->\n` +
        ` Automation, then re-run this script -- it will activate automatically next time.)`,
    );
    return;
  }
  if (outcome.status !== "ready") {
    console.log(
      `\nTask is not ready to run yet: ${outcome.status}${"reason" in outcome ? ` -- ${outcome.reason}` : ""}`,
    );
    return;
  }
  console.log(`Contract ${outcome.contractId} is active. Allowed tools: ${outcome.tools.join(", ")}`);

  const agent = new AuthorityAgentClient({ baseUrl: AUTHORITY_URL, token: AGENT_RUNTIME_KEY });
  await agent.sessions.create({ taskId: task.taskId });

  const manifest = await agent.tools.list(task.taskId);
  console.log(`\nPermitted tools for this task: ${manifest.tools.map((t) => t.tool).join(", ")}`);

  const result = await agent.tools.execute({
    taskId: task.taskId,
    tool: "gmail.list_labels",
    operation: "list_labels",
    resource: "labels",
    arguments: {},
  });

  if (result.status === "executed") {
    console.log(`\nExecuted: ${result.result}. Receipt: ${result.receiptId ?? "(none)"}`);
    console.log(`Labels: ${JSON.stringify(result.data)}`);
  } else {
    console.log(`\nNot executed: ${result.status}`);
  }

  await agent.sessions.close();
}

main().catch((error) => {
  console.error(`\nFailed: ${describeError(error)}`);
  process.exitCode = 1;
});
