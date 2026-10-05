#!/usr/bin/env node
/**
 * One runner for all six connectors, sharing the same @authority/sdk calls
 * every other example in this repo uses -- no manual capability copying, no
 * raw SQL. Each run: resolves an already-existing connection or delegation
 * (never creates one -- set it up first on the dashboard or via the
 * developer API, exactly as a real integration would), binds a fresh task
 * to it, prepares a minimum-scope contract for ONE safe, read-only
 * operation, handles automatic activation or a pending-approval status,
 * executes that operation through the real connector path and prints the
 * receipt, then demonstrates an out-of-scope call being denied before any
 * dispatch.
 *
 * This never tells you whether the underlying connection is LIVE (a real
 * provider account) or FIXTURE (this repo's own in-memory test server) --
 * that is entirely a property of how the connection itself was configured
 * on the dashboard, not something this script can see or control. Gmail
 * and GitHub, run against the deployed service with a real OAuth
 * connection/App installation, are LIVE. Stripe/Slack/Postgres/Custom API
 * are FIXTURE unless you have configured that connection with a real
 * account's credentials yourself.
 *
 * Setup: cp .env.example .env.local, fill in the Authority section plus the
 * one connector-specific section you want to run.
 * Run: npm install && npm run sdk:build (repo root, once), then:
 *   node run.mjs --connector=gmail
 *   node run.mjs --connector=github
 *   node run.mjs --connector=stripe
 *   node run.mjs --connector=slack
 *   node run.mjs --connector=postgres
 *   node run.mjs --connector=custom-api
 */

import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AuthorityAgentClient, AuthorityApiError, AuthorityBackendClient } from "@authority/sdk";

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
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill in that connector's section.`);
    process.exit(1);
  }
  return value;
}

/** Never prints a token, a capability, or a raw error body. */
function describeError(error) {
  if (error instanceof AuthorityApiError) {
    return `${error.code} (http ${error.status}${error.requestId ? `, request ${error.requestId}` : ""}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

const connectorArg = process.argv.find((a) => a.startsWith("--connector="))?.split("=")[1];
const SUPPORTED = ["gmail", "github", "stripe", "slack", "postgres", "custom-api"];
if (!connectorArg || !SUPPORTED.includes(connectorArg)) {
  console.error(`Usage: node run.mjs --connector=<${SUPPORTED.join("|")}>`);
  process.exit(1);
}

const AUTHORITY_URL = env.AUTHORITY_URL || "http://localhost:3000";
const BACKEND_API_KEY = requireEnv("AUTHORITY_BACKEND_API_KEY");
const AGENT_ID = requireEnv("AUTHORITY_AGENT_ID");
const AGENT_RUNTIME_KEY = requireEnv("AUTHORITY_AGENT_RUNTIME_KEY");
const CUSTOMER_ID = requireEnv("CUSTOMER_ID");

// Fresh per logical run, same reasoning as examples/gmail-quickstart and
// examples/model-driven-agent's own RUN_ID: this repo's schema permanently
// maps one compiled plan identity to one contract, so a stable key would
// get stuck forever once that one contract's ephemeral window (default 1
// hour) expires. Set RUN_ID yourself to resume a specific prior run.
const RUN_ID = env.RUN_ID || `run-${Date.now()}-${randomBytes(3).toString("hex")}`;
if (!env.RUN_ID) {
  console.log(`Run ID: ${RUN_ID} (set RUN_ID=${RUN_ID} to resume this exact run)`);
}

/**
 * Per-connector shape. `safeOperation` is the one read-only call this
 * script makes for real; `outOfScopeTool` is a tool never offered in this
 * task's manifest, attempted solely to prove it is denied before dispatch.
 * Postgres and Custom API tools are tenant-published (no fixed name exists
 * across tenants), so their operation details come from env vars instead
 * of being hardcoded here.
 */
function connectorSpec() {
  switch (connectorArg) {
    case "gmail":
      return {
        connectorId: "gmail",
        intent: "List my Gmail labels (connector-quickstart)",
        safeOperation: {
          tool: "gmail.list_labels",
          operation: "list_labels",
          resource: "labels",
          arguments: {},
        },
        outOfScopeTool: {
          tool: "gmail.send_email",
          operation: "send_email",
          resource: "nobody@example.com",
          arguments: { to: "nobody@example.com", subject: "test", body: "test" },
        },
      };
    case "stripe":
      return {
        connectorId: "stripe",
        intent: "Retrieve a test-mode Stripe payment (connector-quickstart)",
        safeOperation: {
          tool: "stripe.retrieve_payment",
          operation: "retrieve_payment",
          resource: env.STRIPE_PAYMENT_ID || "pi_1demo",
          arguments: { payment_id: env.STRIPE_PAYMENT_ID || "pi_1demo" },
        },
        outOfScopeTool: {
          tool: "stripe.issue_refund",
          operation: "issue_refund",
          resource: env.STRIPE_PAYMENT_ID || "pi_1demo",
          arguments: { payment_id: env.STRIPE_PAYMENT_ID || "pi_1demo", amount_cents: 100 },
        },
      };
    case "slack":
      return {
        connectorId: "slack",
        intent: "List Slack channels (connector-quickstart)",
        safeOperation: {
          tool: "slack.list_channels",
          operation: "list_channels",
          resource: "workspace",
          arguments: {},
        },
        outOfScopeTool: {
          tool: "slack.send_message",
          operation: "send_message",
          resource: env.SLACK_CHANNEL_ID || "C000000",
          arguments: { channel: env.SLACK_CHANNEL_ID || "C000000", text: "test" },
        },
      };
    case "postgres":
      return {
        connectorId: "postgres",
        intent: "Run a published Postgres query (connector-quickstart)",
        safeOperation: {
          tool: requireEnv("POSTGRES_TOOL"),
          operation: requireEnv("POSTGRES_OPERATION"),
          resource: env.POSTGRES_RESOURCE || "default",
          arguments: JSON.parse(env.POSTGRES_ARGS_JSON || "{}"),
        },
        outOfScopeTool: null, // no fixed write tool exists across tenants -- skipped, noted in output.
      };
    case "custom-api":
      return {
        connectorId: "custom_api",
        intent: "Call a published Custom API operation (connector-quickstart)",
        safeOperation: {
          tool: requireEnv("CUSTOM_API_TOOL"),
          operation: requireEnv("CUSTOM_API_OPERATION"),
          resource: env.CUSTOM_API_RESOURCE || "default",
          arguments: JSON.parse(env.CUSTOM_API_ARGS_JSON || "{}"),
        },
        outOfScopeTool: null,
      };
    case "github":
      // connectorId/safeOperation/outOfScopeTool are placeholders here --
      // GitHub never uses connectorBindings (resolveConnection is never
      // called for it; see main()'s `connectorArg === "github"` branch),
      // and main() overwrites safeOperation/outOfScopeTool once the
      // repository is actually resolved, since github.get_issue's resource
      // depends on which repository that turns out to be.
      return {
        connectorId: "github",
        intent: "Read a GitHub issue (connector-quickstart)",
        safeOperation: null,
        outOfScopeTool: null,
      };
    default:
      throw new Error("unreachable");
  }
}

async function resolveConnection(backend) {
  if (env.CONNECTION_ID) return env.CONNECTION_ID;
  const { connections } = await backend.connections.list(CUSTOMER_ID);
  const match = connections.find((c) => c.connectorId === connectorSpec().connectorId);
  if (!match) {
    console.error(
      `No ${connectorSpec().connectorId} connection usable by customer ${CUSTOMER_ID}. Set up a connection ` +
        `(dashboard or developer API) and delegate it to this customer first, or set CONNECTION_ID directly.`,
    );
    process.exit(1);
  }
  return match.connectionId;
}

async function resolveRepository(backend) {
  if (env.REPOSITORY_ID) return env.REPOSITORY_ID;
  const { repositories } = await backend.githubRepositories.list(CUSTOMER_ID);
  if (repositories.length === 0) {
    console.error(
      `No GitHub repository delegated to customer ${CUSTOMER_ID}. Delegate one (Settings -> Applications) ` +
        `first, or set REPOSITORY_ID directly.`,
    );
    process.exit(1);
  }
  return repositories[0].repositoryId;
}

async function main() {
  const spec = connectorSpec();
  const backend = new AuthorityBackendClient({ baseUrl: AUTHORITY_URL, apiKey: BACKEND_API_KEY });

  const task = await backend.tasks.create({
    customerId: CUSTOMER_ID,
    agentId: AGENT_ID,
    intent: spec.intent,
    connections:
      connectorArg === "github"
        ? undefined
        : [{ connectorId: spec.connectorId, connectionId: await resolveConnection(backend) }],
    idempotencyKey: `connector-quickstart-${connectorArg}-${CUSTOMER_ID}-${RUN_ID}`,
  });
  console.log(`Task: ${task.taskId}`);

  if (connectorArg === "github") {
    const repositoryId = await resolveRepository(backend);
    const bound = await backend.tasks.bindGithubRepository(task.taskId, repositoryId);
    console.log(`Bound GitHub repository: ${bound.repositoryId}`);
    spec.safeOperation = {
      tool: "github.get_issue",
      operation: "get_issue",
      resource: env.GITHUB_REPO_FULL_NAME || repositoryId,
      arguments: { issue_number: env.GITHUB_ISSUE_NUMBER || "1" },
    };
    spec.outOfScopeTool = {
      tool: "github.create_issue",
      operation: "create_issue",
      resource: env.GITHUB_REPO_FULL_NAME || repositoryId,
      arguments: { title: "test", body: "test" },
    };
  }

  const outcome = await backend.tasks.prepare(
    task.taskId,
    {
      plan: {
        schemaVersion: 1,
        nodes: [
          {
            id: "n1",
            sequence: 0,
            tool: spec.safeOperation.tool,
            arguments: spec.safeOperation.arguments,
            expectedSideEffect: "read",
          },
        ],
      },
    },
    `connector-quickstart-prepare-${connectorArg}-${CUSTOMER_ID}-${RUN_ID}`,
  );

  if (outcome.status !== "ready") {
    console.log(`\nTask is not ready: ${outcome.status}.`);
    if (outcome.status === "awaiting_approval") {
      console.log(
        `This is expected for several of these connectors (see each connector's own approval-rules behavior) -- ` +
          `not a failure. Activate at ${new URL(outcome.approvalPath, AUTHORITY_URL)}, or allow-list ` +
          `${spec.safeOperation.tool} under Settings -> Applications -> Automation if it is eligible, then re-run ` +
          `with the same RUN_ID=${RUN_ID} to resume.`,
      );
    }
    return;
  }
  console.log(`Contract ${outcome.contractId} is active. Allowed tools: ${outcome.tools.join(", ")}`);

  const agent = new AuthorityAgentClient({ baseUrl: AUTHORITY_URL, token: AGENT_RUNTIME_KEY });
  await agent.sessions.create({ taskId: task.taskId });

  const manifest = await agent.tools.list(task.taskId);
  console.log(`Filtered manifest: ${manifest.tools.map((t) => t.tool).join(", ")}`);

  const result = await agent.tools.execute({ taskId: task.taskId, ...spec.safeOperation });
  if (result.status === "executed") {
    console.log(`Executed: ${result.result}. Receipt: ${result.receiptId ?? "(none)"}`);
  } else {
    console.log(`Not executed: ${result.status}${"summary" in result ? ` -- ${result.summary}` : ""}`);
  }

  if (!spec.outOfScopeTool) {
    console.log(
      "\n(No fixed out-of-scope tool exists across tenants for this connector -- skipped. Any tool not " +
        "published/bound to this task would be denied the same way gmail.send_email is in examples/model-driven-agent.)",
    );
  } else {
    console.log(
      `\nAttempting an out-of-scope call (${spec.outOfScopeTool.tool}) -- never offered, never bound...`,
    );
    const denied = await agent.tools.execute({ taskId: task.taskId, ...spec.outOfScopeTool });
    if (denied.status === "executed") {
      throw new Error("SECURITY REGRESSION: an out-of-scope tool call was executed. This must never happen.");
    }
    console.log(
      `Correctly refused before any dispatch: ${denied.status}${"summary" in denied ? ` -- ${denied.summary}` : ""}`,
    );
  }

  await agent.sessions.close();
}

main().catch((error) => {
  console.error(`\nFailed: ${describeError(error)}`);
  process.exitCode = 1;
});
