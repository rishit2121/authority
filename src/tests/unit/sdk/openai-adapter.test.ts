// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  handleOpenAIToolCall,
  openAIToolName,
  toOpenAITools,
} from "../../../../packages/authority-sdk/src/adapters/openai";
import { Authority } from "../../../../packages/authority-sdk/src/authority";
import { AuthorityConfigError } from "../../../../packages/authority-sdk/src/errors";
import type { HandleOpenAIToolCallOptions } from "../../../../packages/authority-sdk/src/adapters/openai";
import {
  AGENT_ID,
  SLACK_MANIFEST_ENTRY,
  TASK_ID,
  allow,
  deny,
  fakeAuthority,
  manifest,
  session,
  type FakeHandler,
} from "./support";

const TOKEN = "authority_ts_A";

async function openWith(routes: Record<string, FakeHandler>, tools: unknown[] = [SLACK_MANIFEST_ENTRY]) {
  const server = fakeAuthority({
    "POST /api/v1/sessions": () => ({ body: session(TASK_ID, TOKEN) }),
    [`GET /api/v1/tasks/${TASK_ID}/tools`]: () => ({ body: manifest(TASK_ID, tools) }),
    ...routes,
  });
  const authority = new Authority({
    baseUrl: "https://authority.example",
    backendKey: "authority_dk_b",
    agentId: AGENT_ID,
    runtimeKey: "authority_rk_r",
    fetch: server.fetch,
  });
  const task = await authority.openTask(TASK_ID);
  server.requests.length = 0;
  return { server, task };
}

const EMAIL_ENTRY = {
  tool: "gmail.send_email",
  description: "Send an email",
  inputSchema: {
    type: "object",
    properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
    required: ["to", "subject"],
    additionalProperties: false,
  },
  resourceConstraints: [{ key: "to", equals: "alice@example.com" }],
  maxInvocations: 1,
  remainingInvocations: 1,
  openArguments: ["body", "subject"],
  generatedArguments: ["body", "subject"],
  requiresApproval: false,
};

describe("OpenAI adapter: schemas", () => {
  it("exposes only open inputs; pinned keys and their values never appear", async () => {
    const { task } = await openWith({});
    const tools = await toOpenAITools(task);
    expect(tools).toEqual([
      {
        type: "function",
        function: {
          name: "slack__post_message",
          description: expect.stringContaining("Post a message"),
          parameters: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
    ]);
    const serialized = JSON.stringify(tools);
    expect(serialized).not.toContain("C0ENGINEERING");
    expect(serialized).not.toContain(TOKEN);
    expect(tools[0]!.function.name).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("one function per pinned set when a tool is allowed for two recipients", async () => {
    const bob = { ...EMAIL_ENTRY, resourceConstraints: [{ key: "to", equals: "bob@example.com" }] };
    const { task } = await openWith({}, [EMAIL_ENTRY, bob]);
    const tools = await toOpenAITools(task);
    expect(tools.map((t) => t.function.name)).toEqual(["gmail__send_email__1", "gmail__send_email__2"]);
    for (const t of tools) {
      expect(Object.keys((t.function.parameters as { properties: object }).properties).sort()).toEqual([
        "body",
        "subject",
      ]);
    }
    expect(JSON.stringify(tools)).not.toContain("@example.com");
  });

  it("maps names to OpenAI's pattern and keeps long names within 64 characters", async () => {
    expect(openAIToolName("slack.post_message")).toBe("slack__post_message");
    const long = { ...SLACK_MANIFEST_ENTRY, tool: `custom_${"a".repeat(32)}.${"op_".repeat(15)}x` };
    const { task } = await openWith({}, [long]);
    const [tool] = await toOpenAITools(task);
    expect(tool!.function.name.length).toBeLessThanOrEqual(64);
    expect(tool!.function.name).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe("OpenAI adapter: tool calls", () => {
  it("maps the name back, fills the pin, calls the task, and returns a result with no credentials", async () => {
    const { server, task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": () => ({
        body: { result: "succeeded", executionId: "e1", receiptId: "r1", data: { ts: "1.2" } },
      }),
    });
    const output = await handleOpenAIToolCall(
      task,
      {
        id: "call_1",
        type: "function",
        function: { name: "slack__post_message", arguments: '{"text":"Done."}' },
      },
      { idempotencyKey: "run-1:call_1" },
    );
    const authorize = server.requests.find((r) => r.path === "/api/v1/authorize")!;
    expect(authorize.body).toMatchObject({
      tool: "slack.post_message",
      arguments: { text: "Done.", channel: "C0ENGINEERING" },
      idempotencyKey: "run-1:call_1:authorize",
    });
    expect(JSON.parse(output)).toEqual({ status: "executed", receiptId: "r1", data: { ts: "1.2" } });
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain("authority_cap_SECRET");
  });

  it("round-trips a Responses API function_call and the right pinned set", async () => {
    const bob = { ...EMAIL_ENTRY, resourceConstraints: [{ key: "to", equals: "bob@example.com" }] };
    const { server, task } = await openWith({ "POST /api/v1/authorize": () => ({ body: deny(["X"]) }) }, [
      EMAIL_ENTRY,
      bob,
    ]);
    await handleOpenAIToolCall(
      task,
      { type: "function_call", call_id: "c2", name: "gmail__send_email__2", arguments: '{"subject":"Hi"}' },
      { idempotencyKey: "k2" },
    );
    const authorize = server.requests.find((r) => r.path === "/api/v1/authorize")!;
    expect(authorize.body).toMatchObject({
      tool: "gmail.send_email",
      arguments: { subject: "Hi", to: "bob@example.com" },
    });
  });

  it("a model-supplied pinned key is sent unmodified and the refusal is returned without secrets", async () => {
    const { server, task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: deny(["CONSTRAINT_VIOLATION"]) }),
    });
    const output = await handleOpenAIToolCall(
      task,
      { function: { name: "slack__post_message", arguments: '{"text":"x","channel":"C0ATTACKER"}' } },
      { idempotencyKey: "k3" },
    );
    const authorize = server.requests.find((r) => r.path === "/api/v1/authorize")!;
    expect((authorize.body as { arguments: unknown }).arguments).toEqual({
      text: "x",
      channel: "C0ATTACKER",
    });
    expect(JSON.parse(output)).toMatchObject({ status: "denied", reasonCodes: ["CONSTRAINT_VIOLATION"] });
    expect(server.paths()).not.toContain("POST /api/v1/execute");
  });

  it("indeterminate results tell the model not to retry", async () => {
    const { task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": () => ({ status: 504, body: { error: { code: "EXECUTION_INDETERMINATE" } } }),
    });
    const output = await handleOpenAIToolCall(
      task,
      { function: { name: "slack__post_message", arguments: '{"text":"x"}' } },
      { idempotencyKey: "k4" },
    );
    expect(JSON.parse(output)).toMatchObject({ status: "indeterminate" });
    expect(JSON.parse(output).message).toMatch(/Do not retry/);
  });

  it("unknown names and malformed arguments are answered without any authorize request", async () => {
    const { server, task } = await openWith({});
    const unknown = await handleOpenAIToolCall(
      task,
      { function: { name: "gmail__send_email", arguments: "{}" } },
      { idempotencyKey: "k5" },
    );
    const malformed = await handleOpenAIToolCall(
      task,
      { function: { name: "slack__post_message", arguments: "{not json" } },
      { idempotencyKey: "k6" },
    );
    expect(JSON.parse(unknown).status).toBe("unknown_tool");
    expect(JSON.parse(malformed).status).toBe("invalid_arguments");
    expect(server.paths().filter((p) => p !== `GET /api/v1/tasks/${TASK_ID}/tools`)).toEqual([]);
  });

  it("still requires an idempotency key", async () => {
    const { task } = await openWith({});
    await expect(
      handleOpenAIToolCall(
        task,
        { function: { name: "slack__post_message", arguments: '{"text":"x"}' } },
        {} as HandleOpenAIToolCallOptions,
      ),
    ).rejects.toBeInstanceOf(AuthorityConfigError);
  });
});
