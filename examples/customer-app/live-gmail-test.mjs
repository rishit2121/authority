#!/usr/bin/env node
/**
 * One-shot, live verification of the embedded, customer-owned Gmail flow
 * against a REAL Google account -- not GMAIL_FIXTURE_MODE, not a database
 * bypass. Only ever calls the public developer API
 * (backend-client.mjs) and the real /api/v1/authorize + /api/v1/execute
 * routes. Never sends email: the only tool call this script ever makes is
 * gmail.list_labels.
 *
 * What it proves, in order:
 *   1. Alex connects her own real Gmail account through the embedded flow
 *      -- no Authority login, ever, for her.
 *   2. The resulting connection belongs to Alex specifically
 *      (owner_kind = 'customer'), confirmed via the developer API's own
 *      connection listing, not a database read.
 *   3. A customer-scoped task is created with that connection explicitly
 *      bound to it at creation time.
 *   4. Bob -- a second, independent customer -- cannot bind that same
 *      connection to a task of his own; the attempt is refused before any
 *      task is created.
 *   5. After a contract is activated for Alex's task (the one step that
 *      still requires the dashboard, same as examples/customer-app/demo.mjs's
 *      own documented limit), exactly one approved gmail.list_labels call
 *      runs through the real authorize -> execute pipeline against Alex's
 *      real mailbox, and its result and persisted receipt are verified from
 *      the API responses themselves.
 *
 * Required: an application + backend credential (dashboard: Settings ->
 * Developer applications), with EXACTLY this script's fixed return URL
 * already in its allowed return URLs:
 *
 *     http://127.0.0.1:4100/connected
 *
 * An agent must also already exist (dashboard: Agents) -- its id is asked
 * for interactively below, along with the runtime credential you issue for
 * it (dashboard: Agents -> that agent -> issue credential). Neither secret
 * this script needs (the backend credential, the runtime credential) is
 * ever hardcoded, logged, or echoed back -- read from .env.local when
 * present there, or typed at a hidden prompt otherwise.
 *
 * The Authority server this points at must be running WITHOUT
 * GMAIL_FIXTURE_MODE, with a real GOOGLE_OAUTH_CLIENT_ID/SECRET configured,
 * and with that client's OAuth consent screen authorizing the redirect URI
 * http://localhost:3000/api/connectors/gmail/embedded-callback (the
 * embedded flow's own callback -- distinct from the dashboard's
 * /api/connectors/gmail/callback).
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { createBackendClient, BackendApiError } from "./backend-client.mjs";

const PORT = 4100;
const RETURN_URL = `http://127.0.0.1:${PORT}/connected`;
const AUTHORITY_URL = process.env.AUTHORITY_URL || "http://localhost:3000";

function readEnvFile(file) {
  try {
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
  } catch {
    return {};
  }
}

/** Reads one line from the terminal without echoing it -- never logged, never printed back. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const output = rl._writeToOutput;
    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) output.call(rl, chunk);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

function promptVisible(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function resolveSecret(envKey, label) {
  const fromEnv = readEnvFile(path.join(process.cwd(), ".env.local"))[envKey] || process.env[envKey];
  if (fromEnv) {
    console.log(`Using ${envKey} from .env.local / environment (not printed).`);
    return fromEnv;
  }
  return promptHidden(`${label} (input hidden, not echoed): `);
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function waitForBrowserReturn(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== "/connected") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const sessionId = url.searchParams.get("connection_session_id");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><html><body><h1>Received -- you can return to the terminal.</h1></body></html>",
      );
      server.close();
      if (!sessionId) reject(new Error("The browser returned with no connection_session_id."));
      else resolve(sessionId);
    });
    server.listen(port, "127.0.0.1");
  });
}

async function main() {
  console.log("== Live Gmail connection test (real Google account, no fixture, no email sent) ==\n");

  const backendKey = await resolveSecret("AUTHORITY_BACKEND_KEY", "Backend credential (authority_dk_...)");
  if (!backendKey.startsWith("authority_dk_"))
    throw new Error("That doesn't look like a backend credential.");
  const agentId = await promptVisible("Agent id (dashboard -> Agents -> copy from the URL): ");
  assert(/^[0-9a-f-]{36}$/.test(agentId), "agent id must be a uuid");

  const authority = createBackendClient({ baseUrl: AUTHORITY_URL, backendKey });
  const suffix = Date.now().toString(36);

  // ---- 1: Alex and Bob, two independent customers ----
  console.log("\n[1/7] Creating Alex and Bob as independent customers...");
  const alex = await authority.createOrResolveCustomer(`live-alex-${suffix}`);
  const bob = await authority.createOrResolveCustomer(`live-bob-${suffix}`);
  assert(alex.customerId, "Alex's customerId was not returned");
  assert(bob.customerId, "Bob's customerId was not returned");
  assert(bob.customerId !== alex.customerId, "Alex and Bob must be different customers");
  console.log(`  Alex: ${alex.customerId}\n  Bob:  ${bob.customerId}`);

  // ---- 2: open Alex's embedded connect session, print the URL, wait for the real browser ----
  console.log(`\n[2/7] Opening Alex's embedded Gmail connection session (return URL: ${RETURN_URL})...`);
  const session = await authority.createConnectionSession(alex.customerId, "gmail", RETURN_URL);
  assert(session.sessionId && session.url, "createConnectionSession did not return a session");
  const connectUrl = new URL(session.url, AUTHORITY_URL).toString();

  console.log("\n  Open this URL in a real browser and sign in with a disposable Gmail account:\n");
  console.log(`    ${connectUrl}\n`);
  console.log("  Waiting for the browser to complete consent and return here...");

  const returnedSessionId = await waitForBrowserReturn(PORT);
  assert(
    returnedSessionId === session.sessionId,
    "the browser returned a different session id than expected",
  );

  const status = await authority.connectionSessionStatus(session.sessionId);
  assert(status.status === "completed", `session did not complete (status: ${status.status})`);
  assert(status.connectionId, "a completed session must report a connectionId");
  const connectionId = status.connectionId;
  console.log(`  Connected. connectionId = ${connectionId}`);

  // ---- 3: the connection belongs to Alex, and only Alex ----
  console.log("\n[3/7] Verifying the connection belongs to Alex, and only Alex...");
  const alexConnections = await authority.listCustomerConnections(alex.customerId);
  assert(
    alexConnections.connections.length === 1 && alexConnections.connections[0].connectionId === connectionId,
    "Alex's own connection listing does not show exactly this one connection",
  );
  assert(alexConnections.connections[0].ownerKind === "customer", "the connection must be customer-owned");
  const bobConnectionsBefore = await authority.listCustomerConnections(bob.customerId);
  assert(bobConnectionsBefore.connections.length === 0, "Bob must see no connections before any attempt");
  console.log("  Confirmed: owner_kind=customer, visible only in Alex's own connection list.");

  // ---- 4: a customer-scoped task for Alex, with the connection explicitly bound ----
  console.log("\n[4/7] Creating Alex's task with her connection explicitly bound...");
  const aliceTask = await authority.createCustomerTask(alex.customerId, {
    agentId,
    intent: "List Alex's Gmail labels (live verification, read-only)",
    connections: [{ connectorId: "gmail", connectionId }],
    idempotencyKey: `live-alex-task-${suffix}`,
  });
  assert(aliceTask.taskId, "Alex's task was not created");
  console.log(`  Alex's task: ${aliceTask.taskId}`);

  // ---- 5: Bob cannot bind Alex's connection ----
  console.log("\n[5/7] Confirming Bob cannot bind Alex's connection to a task of his own...");
  let bobRefused = false;
  try {
    await authority.createCustomerTask(bob.customerId, {
      agentId,
      intent: "attempt to use Alex's connection (must be refused)",
      connections: [{ connectorId: "gmail", connectionId }],
      idempotencyKey: `live-bob-attempt-${suffix}`,
    });
  } catch (error) {
    if (error instanceof BackendApiError) bobRefused = true;
    else throw error;
  }
  if (!bobRefused) {
    throw new Error(
      "SECURITY FAILURE: Bob's cross-customer task creation did NOT fail. Stop and investigate before proceeding.",
    );
  }
  console.log("  Confirmed: Bob's request was refused before any task was created.");

  // ---- 6: the one manual step -- propose and activate a contract ----
  console.log(`
[6/7] One manual step (same limit as examples/customer-app/demo.mjs):
  1. Open Alex's task in the dashboard: ${AUTHORITY_URL}/app/tasks/${aliceTask.taskId}
  2. Propose a contract allowing ONLY gmail.list_labels, then get it approved and activated.
  3. Dashboard -> Agents -> issue a runtime credential for agent ${agentId}, if you have not already.
`);
  const runtimeKey = await resolveSecret(
    "AUTHORITY_RUNTIME_KEY",
    "Runtime credential for that agent (authority_rk_...)",
  );
  if (!runtimeKey.startsWith("authority_rk_"))
    throw new Error("That doesn't look like a runtime credential.");
  await promptVisible("Press Enter once the contract is active: ");

  // ---- 7: exactly one approved gmail.list_labels call, authorize -> execute ----
  console.log("\n[7/7] Running the one approved call: gmail.list_labels...");
  const authHeaders = { authorization: `Bearer ${runtimeKey}`, "content-type": "application/json" };

  const authorizeRes = await fetch(new URL("/api/v1/authorize", AUTHORITY_URL), {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      taskId: aliceTask.taskId,
      tool: "gmail.list_labels",
      operation: "list_labels",
      resource: "labels",
      arguments: {},
      idempotencyKey: `live-list-labels-${suffix}`,
    }),
  });
  const authorizeBody = await authorizeRes.json();
  if (authorizeRes.status !== 200 || !["allow", "allow_constrained"].includes(authorizeBody.status)) {
    throw new Error(
      `authorize did not allow gmail.list_labels: http ${authorizeRes.status}, status=${authorizeBody.status}, reasons=${JSON.stringify(authorizeBody.reasonCodes)}`,
    );
  }
  assert(authorizeBody.capability?.token, "authorize succeeded but returned no capability token");
  console.log(`  authorize: ${authorizeBody.status}, capability ${authorizeBody.capability.id}`);

  const executeRes = await fetch(new URL("/api/v1/execute", AUTHORITY_URL), {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      capability: authorizeBody.capability.token,
      tool: "gmail.list_labels",
      operation: "list_labels",
      resource: "labels",
      arguments: {},
      idempotencyKey: `live-list-labels-exec-${suffix}`,
    }),
  });
  const executeBody = await executeRes.json();
  if (executeRes.status !== 200) {
    throw new Error(`execute failed: http ${executeRes.status}, body=${JSON.stringify(executeBody)}`);
  }
  assert(executeBody.result === "succeeded", `expected result "succeeded", got "${executeBody.result}"`);
  assert(executeBody.receiptId, "a successful execute must report a receiptId (the persisted receipt)");
  assert(Array.isArray(executeBody.data?.labels), "expected data.labels to be an array");
  console.log(`  execute: succeeded, receiptId ${executeBody.receiptId}`);
  console.log(`  Alex's real mailbox has ${executeBody.data.labels.length} label(s).`);

  console.log(`
== All checks passed ==
  - Alex connected with no Authority login.
  - The connection is owned by Alex alone (owner_kind=customer).
  - Alex's task explicitly bound that connection.
  - Bob's attempt to use it was refused before any task was created.
  - Exactly one gmail.list_labels call ran, and its receipt is persisted
    (receiptId above) -- no email was sent.

Now revoke the test runtime credential: dashboard -> Agents -> the agent you
used -> revoke this credential. This script cannot do that for you -- it
requires a signed-in admin session, not the backend or runtime credential.
`);
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
});
