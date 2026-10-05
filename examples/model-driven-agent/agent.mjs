#!/usr/bin/env node
/**
 * A real model decides which tool to call, from the SAME filtered manifest
 * an agent would see, routed entirely through @authority/sdk. Demonstrates
 * two things, not one:
 *
 *   1. An ALLOWED call: the model is given only the tools this task's
 *      active contract actually permits (gmail.list_labels, read-only),
 *      picks one, and it executes successfully.
 *   2. An OUT-OF-SCOPE call DENIED BEFORE DISPATCH: this script then
 *      itself attempts gmail.send_email -- a tool that was never in the
 *      manifest the model saw, and is not in this contract's allowed
 *      actions. Authority denies it at authorize() time, before any
 *      connector ever runs, and no email is sent. This is the point: tool-
 *      list filtering is convenience and exposure reduction, never the
 *      actual security boundary -- runtime authorization is mandatory for
 *      every call regardless of what a (possibly stale, possibly ignored)
 *      manifest showed. This script never implements a fallback that would
 *      let an out-of-scope call through; it only ever calls
 *      AuthorityAgentClient.tools.execute() and reports exactly what comes
 *      back.
 *
 * Requires an already-connected Gmail customer -- run
 * examples/gmail-quickstart first if you don't have one. Needs an OpenAI
 * API key (separate from, and never sent to, Authority) to use a real
 * model; without one, runs in --manual mode instead, making the exact same
 * two tool calls a model would have, so both demonstrations above still
 * run with no model credentials at all.
 *
 * Setup: cp .env.example .env.local, fill in the Authority section (see
 * .env.example's own comments) and, optionally, the model section.
 * Run: npm install && npm run sdk:build (repo root, once), then npm start.
 *
 * Never sends email: the one out-of-scope call this script makes is always
 * denied before any connector dispatch.
 */

import { readFileSync, existsSync } from "node:fs";
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
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}

const AUTHORITY_URL = env.AUTHORITY_URL || "http://localhost:3000";
const BACKEND_API_KEY = requireEnv("AUTHORITY_BACKEND_API_KEY");
const AGENT_ID = requireEnv("AUTHORITY_AGENT_ID");
const AGENT_RUNTIME_KEY = requireEnv("AUTHORITY_AGENT_RUNTIME_KEY");
const CUSTOMER_ID = requireEnv("CUSTOMER_ID");

// Model credentials -- intentionally read and used only here, never passed
// to any AuthorityBackendClient/AuthorityAgentClient call.
const OPENAI_API_KEY = env.OPENAI_API_KEY || null;
const OPENAI_MODEL = env.OPENAI_MODEL || "gpt-6-luna";

function describeError(error) {
  if (error instanceof AuthorityApiError) {
    return `${error.code} (http ${error.status}${error.requestId ? `, request ${error.requestId}` : ""}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Converts a manifest's tools into OpenAI's function-calling format. The model is given exactly this list -- nothing else. */
function toOpenAiTools(manifest) {
  return manifest.tools.map((t) => ({
    type: "function",
    function: { name: t.tool.replace(/\./g, "__"), description: t.description, parameters: t.inputSchema },
  }));
}

/** A real model call. Model credentials never leave this function; the Authority clients never see them. */
async function askModelToPickATool(manifest, instruction) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      // gpt-6-luna defaults to reasoning, which OpenAI's /v1/chat/completions
      // refuses to combine with function tools ("Function tools with
      // reasoning_effort are not supported ... set reasoning_effort to
      // 'none'" -- confirmed directly against the API). This script wants an
      // immediate tool pick, not a reasoning trace, so disable it explicitly
      // rather than switching endpoints.
      reasoning_effort: "none",
      messages: [
        {
          role: "system",
          content:
            "You can only use the tools provided to you. If the user asks for something none of your " +
            "tools can do, say so instead of guessing.",
        },
        { role: "user", content: instruction },
      ],
      tools: toOpenAiTools(manifest),
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI API call failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  const call = body.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) {
    return { decided: null, modelText: body.choices?.[0]?.message?.content ?? "(no response)" };
  }
  return {
    decided: {
      tool: call.function.name.replace(/__/g, "."),
      arguments: JSON.parse(call.function.arguments || "{}"),
    },
    modelText: null,
  };
}

/** No model key: makes the exact decision a model would have for this fixed demo, with no model call at all. */
function pickToolManually() {
  return { decided: { tool: "gmail.list_labels", arguments: {} }, modelText: null };
}

async function main() {
  const backend = new AuthorityBackendClient({ baseUrl: AUTHORITY_URL, apiKey: BACKEND_API_KEY });

  const { connections } = await backend.connections.list(CUSTOMER_ID);
  const connection = connections.find((c) => c.connectorId === "gmail" && c.status === "active");
  if (!connection) {
    console.error(
      "This customer has no active Gmail connection yet. Run examples/gmail-quickstart first, then set " +
        "CUSTOMER_ID here to the customer id it printed.",
    );
    process.exit(1);
  }
  console.log(
    `Customer ${CUSTOMER_ID}: reusing Gmail connection ${connection.verifiedAccountRef ?? connection.connectionId}`,
  );

  const task = await backend.tasks.create({
    customerId: CUSTOMER_ID,
    agentId: AGENT_ID,
    intent: "Model-driven agent example: list Gmail labels",
    connections: [{ connectorId: "gmail", connectionId: connection.connectionId }],
    idempotencyKey: `model-agent-task-${CUSTOMER_ID}`,
  });
  console.log(`Task: ${task.taskId}`);

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
    `model-agent-prepare-${CUSTOMER_ID}`,
  );

  if (outcome.status !== "ready") {
    console.log(`\nTask is not ready: ${outcome.status}.`);
    if (outcome.status === "awaiting_approval") {
      console.log(
        `Activate once at ${new URL(outcome.approvalPath, AUTHORITY_URL)}, or allow-list gmail.list_labels ` +
          `under Settings -> Applications -> Automation, then re-run this script.`,
      );
    }
    return;
  }
  console.log(`Contract ${outcome.contractId} is active. Allowed tools: ${outcome.tools.join(", ")}`);

  const agent = new AuthorityAgentClient({ baseUrl: AUTHORITY_URL, token: AGENT_RUNTIME_KEY });
  await agent.sessions.create({ taskId: task.taskId });

  const manifest = await agent.tools.list(task.taskId);
  console.log(`\nFiltered manifest given to the model: ${manifest.tools.map((t) => t.tool).join(", ")}`);
  console.log("(Note: gmail.send_email is not in this list -- the model is never offered it as an option.)");

  const usingModel = Boolean(OPENAI_API_KEY);
  console.log(
    `\n[1/2] ${usingModel ? `Asking ${OPENAI_MODEL}` : "Manual mode (no OPENAI_API_KEY)"} to pick a tool...`,
  );
  const { decided, modelText } = usingModel
    ? await askModelToPickATool(manifest, "List the labels in my Gmail inbox.")
    : pickToolManually();

  if (!decided) {
    console.log(`Model did not call a tool. Its reply: "${modelText}"`);
  } else {
    console.log(`Decided: ${decided.tool}(${JSON.stringify(decided.arguments)})`);
    const result = await agent.tools.execute({
      taskId: task.taskId,
      tool: decided.tool,
      operation: decided.tool.split(".")[1],
      resource: "labels",
      arguments: decided.arguments,
    });
    if (result.status === "executed") {
      console.log(`Executed: ${result.result}. Receipt: ${result.receiptId ?? "(none)"}`);
      console.log(`Data: ${JSON.stringify(result.data)}`);
    } else {
      console.log(
        `Not executed: ${result.status}${"summary" in result ? ` -- ${result.summary}` : ""} -- stopping here, as a real agent should.`,
      );
    }
  }

  console.log(
    "\n[2/2] Demonstrating the actual security boundary: attempting gmail.send_email anyway -- a tool\n" +
      "      never offered to the model and not in this contract's allowed actions.",
  );
  const denied = await agent.tools.execute({
    taskId: task.taskId,
    tool: "gmail.send_email",
    operation: "send_email",
    resource: "nobody@example.com",
    arguments: { to: "nobody@example.com", subject: "test", body: "test" },
  });
  if (denied.status === "executed") {
    throw new Error("SECURITY REGRESSION: an out-of-scope tool call was executed. This must never happen.");
  }
  console.log(
    `Correctly refused before any dispatch: ${denied.status}${"summary" in denied ? ` -- ${denied.summary}` : ""}`,
  );
  console.log("No email was sent.");

  await agent.sessions.close();
}

main().catch((error) => {
  console.error(`\nFailed: ${describeError(error)}`);
  process.exitCode = 1;
});
