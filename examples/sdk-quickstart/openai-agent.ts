/**
 * The same task, driven by a model through OpenAI tool calling -- with a FAKE model step, so it runs without an
 * OpenAI key. The adapter gives the model only the inputs it may write (the message text); the channel is pinned
 * by the task's contract and never appears in the schema.
 *
 *   npm run openai
 *
 * To use a real model, install `openai` and replace `fakeModelStep` with:
 *
 *   import OpenAI from "openai";
 *   const openai = new OpenAI(); // reads OPENAI_API_KEY
 *   const completion = await openai.chat.completions.create({ model: "<model>", messages, tools });
 *   const message = completion.choices[0]!.message;
 *   messages.push(message);
 *   for (const toolCall of message.tool_calls ?? []) { ...same handling as below... }
 *
 * Your OpenAI key and every Authority credential stay in this process: tool schemas and tool results contain
 * neither, and the model never sees a session or capability token.
 */
import { Authority } from "@authority/sdk";
import { handleOpenAIToolCall, toOpenAITools, type OpenAIFunctionTool } from "@authority/sdk/openai";

import { describePrepare } from "./outcomes";

const user = { id: process.env.AUTHORITY_USER_ID ?? "user-123" };
const event = { id: process.env.EVENT_ID ?? `deploy-${new Date().toISOString().slice(0, 10)}` };

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

/** Stands in for `openai.chat.completions.create`: asks for the first tool, filling only its open inputs. */
function fakeModelStep(_messages: ChatMessage[], tools: OpenAIFunctionTool[]): ChatMessage {
  const tool = tools[0];
  if (!tool) return { role: "assistant", content: "I have no tools for this task." };
  const properties = Object.keys((tool.function.parameters as { properties?: object }).properties ?? {});
  const args = Object.fromEntries(properties.map((key) => [key, "The deployment is complete."]));
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: tool.function.name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

const authority = new Authority({
  baseUrl: process.env.AUTHORITY_URL!,
  backendKey: process.env.AUTHORITY_BACKEND_API_KEY!,
  agentId: process.env.AUTHORITY_AGENT_ID!,
  runtimeKey: process.env.AUTHORITY_AGENT_RUNTIME_KEY!,
});

const request = "Post one engineering update";
const run = await authority.prepareTask({
  userId: user.id,
  request,
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
  const tools = await toOpenAITools(run.task);
  console.log(
    `Model sees: ${tools.map((t) => `${t.function.name}(${Object.keys((t.function.parameters as { properties?: object }).properties ?? {}).join(", ")})`).join("; ")}`,
  );

  const messages: ChatMessage[] = [
    { role: "system", content: "You post short engineering updates. Use the tools you are given." },
    { role: "user", content: request },
  ];
  const reply = fakeModelStep(messages, tools);
  messages.push(reply);
  for (const toolCall of reply.tool_calls ?? []) {
    // One stable key per tool call: a retried run never posts twice.
    const output = await handleOpenAIToolCall(run.task, toolCall, {
      idempotencyKey: `${event.id}:${toolCall.id}`,
    });
    console.log(`${toolCall.function.name} -> ${output}`);
    messages.push({ role: "tool", tool_call_id: toolCall.id, content: output });
  }
  await run.task.close("openai example finished");
}
