#!/usr/bin/env node
/**
 * A minimal, runnable demonstration of embedded customer connections --
 * separate from the Authority control plane, using only the public
 * developer API (never a direct database write or internal bypass).
 *
 * What this proves, in order:
 *   1. Alex and Bob are created as two independent customers of one
 *      application (POST /api/v1/customers).
 *   2. Each connects their own Gmail account through Mode A's embedded
 *      flow -- no Authority credential, no dashboard login, for either of
 *      them (POST /api/v1/connections/sessions, then the opaque URL it
 *      returns, simulated here since this is a script, not a browser).
 *   3. Each customer's own connection listing shows only their own
 *      connection (GET /api/v1/customers/{id}/connections).
 *   4. A task created for Alex naming her own connection succeeds.
 *   5. The SAME task-creation call, naming Bob's connection instead, is
 *      refused before any task is created -- the "cross-customer request
 *      denied before dispatch" this feature exists to guarantee.
 *
 * Required environment:
 *   AUTHORITY_URL           e.g. http://localhost:3000
 *   AUTHORITY_BACKEND_KEY   authority_dk_... (dashboard Settings -> your
 *                           application -> Backend credentials)
 *   AUTHORITY_AGENT_ID      an existing agent id, for step 4/5's task
 *                           creation (dashboard -> Agents)
 *
 * The target Authority deployment must be running with
 * GMAIL_FIXTURE_MODE=1 for step 2 to complete without a real Google
 * account -- see README.md for how to run this against your own
 * disposable Gmail account instead, for opt-in live verification.
 */

import { createBackendClient, BackendApiError } from "./backend-client.mjs";
import { simulateEmbeddedConnect } from "./simulate-browser-connect.mjs";

const baseUrl = process.env.AUTHORITY_URL;
const backendKey = process.env.AUTHORITY_BACKEND_KEY;
const agentId = process.env.AUTHORITY_AGENT_ID;

if (!baseUrl || !backendKey || !agentId) {
  console.error("Set AUTHORITY_URL, AUTHORITY_BACKEND_KEY and AUTHORITY_AGENT_ID -- see README.md.");
  process.exit(1);
}

const authority = createBackendClient({ baseUrl, backendKey });
const RETURN_URL = `${baseUrl}/`; // any allowlisted URL works for this demo; see README.md

async function connectGmail(customerId, label) {
  const session = await authority.createConnectionSession(customerId, "gmail", RETURN_URL);
  console.log(`  opened connection session ${session.sessionId} for ${label}`);

  const result = await simulateEmbeddedConnect(new URL(session.url, baseUrl));
  console.log(`  ${label} "authorized" Gmail (fixture) -> ${result.returnUrl}`);

  const status = await authority.connectionSessionStatus(session.sessionId);
  if (status.status !== "completed" || !status.connectionId) {
    throw new Error(`connectGmail: session did not complete (status: ${status.status})`);
  }
  console.log(`  connection ${status.connectionId} is active for ${label}\n`);
  return status.connectionId;
}

async function main() {
  console.log("1. Creating Alex and Bob as independent customers...");
  const alex = await authority.createOrResolveCustomer("alex-demo");
  const bob = await authority.createOrResolveCustomer("bob-demo");
  console.log(`   alex -> ${alex.customerId} (created: ${alex.wasCreated})`);
  console.log(`   bob  -> ${bob.customerId} (created: ${bob.wasCreated})\n`);

  console.log("2. Each connects their own Gmail account (Mode A, embedded)...");
  const alexConnectionId = await connectGmail(alex.customerId, "Alex");
  const bobConnectionId = await connectGmail(bob.customerId, "Bob");

  console.log("3. Each customer's own connection listing shows only their own connection...");
  const alexConnections = await authority.listCustomerConnections(alex.customerId);
  const bobConnections = await authority.listCustomerConnections(bob.customerId);
  console.log(`   Alex sees: ${alexConnections.connections.map((c) => c.connectionId).join(", ")}`);
  console.log(`   Bob sees:  ${bobConnections.connections.map((c) => c.connectionId).join(", ")}\n`);

  console.log("4. Creating a task for Alex, bound to her own connection (should succeed)...");
  const allowed = await authority.createCustomerTask(alex.customerId, {
    agentId,
    intent: "Summarize Alex's unread support emails",
    connections: [{ connectorId: "gmail", connectionId: alexConnectionId }],
  });
  console.log(`   ALLOWED: task ${allowed.taskId} created, bound to ${alexConnectionId}\n`);

  console.log("5. Creating a task for Alex, naming Bob's connection instead (must be denied)...");
  try {
    await authority.createCustomerTask(alex.customerId, {
      agentId,
      intent: "Try to read Bob's mail from Alex's task",
      connections: [{ connectorId: "gmail", connectionId: bobConnectionId }],
    });
    console.error("   UNEXPECTED: that call should have been refused. This is a bug, not a success.");
    process.exitCode = 1;
  } catch (error) {
    if (error instanceof BackendApiError && error.status === 403) {
      console.log(`   DENIED as expected: ${error.code} -- ${error.message}`);
      console.log("   No task was created. Authority never dispatched anything for this request.\n");
    } else {
      throw error;
    }
  }

  console.log(
    "Done. See README.md for the remaining dashboard step needed to authorize and execute a real tool call.",
  );
}

main().catch((error) => {
  console.error("\nFailed:", error.message ?? error);
  process.exitCode = 1;
});
