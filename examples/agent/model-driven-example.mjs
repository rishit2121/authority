#!/usr/bin/env node
/**
 * A genuinely model-driven example: an LLM picks which tool to call from
 * Authority's own contract-filtered manifest, and every tool call it makes
 * is routed through Authority -- never straight to the provider the tool
 * belongs to. This is the one thing worth seeing clearly: the MODEL's
 * visible tools and AUTHORITY's permission check are two separate things.
 * The manifest below only decides what the model is OFFERED; it is
 * `authority.call()` -- not the model, and not this script -- that decides
 * what is actually ALLOWED to run, exactly as if the model had tried
 * something completely different.
 *
 * Uses the OpenAI-compatible chat completions API directly (no SDK
 * dependency, consistent with this repo's own OPENROUTER_BASE_URL /
 * OPENAI_API_KEY configuration) with standard `tools` function-calling --
 * any OpenAI-compatible provider works, nothing here is OpenRouter-specific.
 *
 *   AUTHORITY_URL=https://your-authority.onrender.com \
 *   AUTHORITY_RUNTIME_KEY=authority_rk_... \
 *   AUTHORITY_TASK_ID=<task uuid> \
 *   OPENROUTER_API_KEY=... OPENROUTER_BASE_URL=https://openrouter.ai/api/v1 OPENROUTER_PLAN_MODEL=... \
 *   node examples/agent/model-driven-example.mjs "What's the status of payment pi_12345?"
 *
 * The task's active contract decides what actually shows up in the manifest; this example makes no
 * assumption about which tools that is, beyond that at least one exists.
 */
import { createAuthorityClient } from "./authority-client.mjs";

const { AUTHORITY_URL, AUTHORITY_RUNTIME_KEY, AUTHORITY_TASK_ID } = process.env;
const { OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_PLAN_MODEL } = process.env;
if (!AUTHORITY_URL || !AUTHORITY_RUNTIME_KEY || !AUTHORITY_TASK_ID) {
  console.error(
    "Set AUTHORITY_URL, AUTHORITY_RUNTIME_KEY and AUTHORITY_TASK_ID. See the Quickstart at /docs/quickstart.",
  );
  process.exit(2);
}
if (!OPENROUTER_API_KEY || !OPENROUTER_BASE_URL || !OPENROUTER_PLAN_MODEL) {
  console.error(
    "Set OPENROUTER_API_KEY, OPENROUTER_BASE_URL and OPENROUTER_PLAN_MODEL (any OpenAI-compatible provider works).",
  );
  process.exit(2);
}
const userPrompt = process.argv.slice(2).join(" ") || "What tools do you have access to? List them.";

const authority = createAuthorityClient({ baseUrl: AUTHORITY_URL, runtimeKey: AUTHORITY_RUNTIME_KEY });

// 1. The manifest is the model's menu, not its authority. Authority still checks every call below.
const manifest = await authority.fetchTools(AUTHORITY_TASK_ID);
console.log(`Contract-filtered manifest: ${manifest.tools.length} tool(s) available to the model.`);

const tools = manifest.tools.map((t) => ({
  type: "function",
  function: { name: t.tool.replace(/\./g, "__"), description: t.description, parameters: t.inputSchema },
}));
const nameToTool = new Map(manifest.tools.map((t) => [t.tool.replace(/\./g, "__"), t]));

async function chat(messages) {
  const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: OPENROUTER_PLAN_MODEL, messages, tools: tools.length ? tools : undefined }),
  });
  if (!res.ok) throw new Error(`chat completion failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const messages = [
  {
    role: "system",
    content: "You may only use the provided tools. If none fit, say so plainly instead of guessing.",
  },
  { role: "user", content: userPrompt },
];

for (let turn = 0; turn < 5; turn++) {
  const completion = await chat(messages);
  const choice = completion.choices[0];
  const toolCalls = choice.message.tool_calls ?? [];

  if (toolCalls.length === 0) {
    console.log(`\nFinal answer: ${choice.message.content}`);
    break;
  }

  messages.push(choice.message);
  for (const call of toolCalls) {
    const tool = nameToTool.get(call.function.name);
    const args = JSON.parse(call.function.arguments || "{}");
    console.log(`\nModel requested: ${tool?.tool ?? call.function.name}(${JSON.stringify(args)})`);

    if (!tool) {
      // The model hallucinated a tool name not in the manifest -- never forwarded to Authority at all.
      messages.push({ role: "tool", tool_call_id: call.id, content: "That tool does not exist." });
      continue;
    }

    // 2. THIS is the only place anything actually happens. The model never talks to Stripe, Gmail, GitHub,
    //    or anything else directly -- it only ever reaches authority.call(), which independently re-checks
    //    this exact tool/operation/resource/arguments against the task's real contract before doing anything.
    const resourceField = Object.keys(args).find((k) => tool.resourceConstraints.some((c) => c.key === k));
    const outcome = await authority.call({
      taskId: AUTHORITY_TASK_ID,
      tool: tool.tool,
      operation: tool.tool.split(".").slice(1).join("."),
      arguments: args,
      resource: resourceField ? String(args[resourceField]) : undefined,
    });

    console.log(`Authority: ${outcome.kind}${outcome.message ? ` -- ${outcome.message}` : ""}`);
    const content =
      outcome.kind === "done"
        ? JSON.stringify(outcome.data ?? { replayed: true })
        : JSON.stringify({ denied: true, reason: outcome.kind, message: outcome.message });
    messages.push({ role: "tool", tool_call_id: call.id, content });
  }
}
