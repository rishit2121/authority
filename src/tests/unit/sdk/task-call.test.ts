// @vitest-environment node
import { describe, expect, it } from "vitest";

import { Authority } from "../../../../packages/authority-sdk/src/authority";
import { AuthorityConfigError } from "../../../../packages/authority-sdk/src/errors";
import type { TaskCallOptions } from "../../../../packages/authority-sdk/src/task";
import {
  AGENT_ID,
  SLACK_MANIFEST_ENTRY,
  TASK_ID,
  allow,
  deny,
  fakeAuthority,
  hang,
  manifest,
  session,
  type FakeHandler,
} from "./support";

const TOKEN = "authority_ts_A";

async function openWith(
  routes: Record<string, FakeHandler>,
  opts: { expiresInMs?: number; tools?: unknown[] } = {},
) {
  const server = fakeAuthority({
    "POST /api/v1/sessions": () => ({ body: session(TASK_ID, TOKEN, opts.expiresInMs) }),
    [`GET /api/v1/tasks/${TASK_ID}/tools`]: () => ({ body: manifest(TASK_ID, opts.tools) }),
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
  server.fetch.mockClear();
  return { server, task };
}

const executed = {
  result: "succeeded",
  executionId: "exec-1",
  receiptId: "rcpt-1",
  execution: { mode: "live", simulated: false },
  data: { ts: "123.456" },
  requestId: "req-exec",
};

describe("AuthorityTask.call: request bodies (compatibility)", () => {
  it("fills the pinned channel in, then authorizes and executes with these exact bodies and the task's token", async () => {
    const { server, task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow(), requestId: "req-auth" }),
      "POST /api/v1/execute": () => ({ body: executed, requestId: "req-exec" }),
    });
    const result = await task.call(
      "slack.post_message",
      { text: "The deployment is complete." },
      { idempotencyKey: "evt-1" },
    );

    expect(server.paths()).toEqual([
      `GET /api/v1/tasks/${TASK_ID}/tools`,
      "POST /api/v1/authorize",
      "POST /api/v1/execute",
    ]);
    const [, authorize, execute] = server.requests;
    expect(authorize!.body).toEqual({
      taskId: TASK_ID,
      tool: "slack.post_message",
      operation: "post_message",
      arguments: { text: "The deployment is complete.", channel: "C0ENGINEERING" },
      idempotencyKey: "evt-1:authorize",
    });
    expect(execute!.body).toEqual({
      capability: "authority_cap_SECRET",
      tool: "slack.post_message",
      operation: "post_message",
      arguments: { text: "The deployment is complete.", channel: "C0ENGINEERING" },
      idempotencyKey: "evt-1:execute",
    });
    for (const r of server.requests) expect(r.authorization).toBe(`Bearer ${TOKEN}`);

    expect(result).toMatchObject({
      status: "executed",
      receiptId: "rcpt-1",
      executionId: "exec-1",
      data: { ts: "123.456" },
      decisionId: "dec-1",
      reasonCodes: ["WITHIN_CONTRACT"],
      requestIds: { authorize: "req-auth", execute: "req-exec" },
      replayed: false,
    });
    expect(JSON.stringify(result)).not.toContain("authority_cap_SECRET");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("sends a conflicting value for a pinned key unmodified, and reports the server's refusal", async () => {
    const { server, task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: deny(["CONSTRAINT_VIOLATION"]) }),
    });
    const result = await task.call(
      "slack.post_message",
      { channel: "C0OTHER", text: "hi" },
      { idempotencyKey: "evt-2" },
    );
    const authorize = server.requests.find((r) => r.path === "/api/v1/authorize")!;
    expect((authorize.body as { arguments: unknown }).arguments).toEqual({ channel: "C0OTHER", text: "hi" });
    expect(result.status).toBe("denied");
    expect(result.reasonCodes).toEqual(["CONSTRAINT_VIOLATION"]);
    expect(server.paths()).not.toContain("POST /api/v1/execute");
  });

  it("sends a pinned number back as a number, per the tool's input schema", async () => {
    const refund = {
      ...SLACK_MANIFEST_ENTRY,
      tool: "stripe.issue_refund",
      inputSchema: {
        type: "object",
        properties: { payment_id: { type: "string" }, amount_cents: { type: "number" } },
      },
      resourceConstraints: [
        { key: "amount_cents", equals: "4900" },
        { key: "payment_id", equals: "pi_1" },
      ],
      openArguments: [],
      generatedArguments: [],
    };
    const { server, task } = await openWith(
      { "POST /api/v1/authorize": () => ({ body: deny(["X"]) }) },
      { tools: [refund] },
    );
    await task.call("stripe.issue_refund", {}, { idempotencyKey: "r-1" });
    const authorize = server.requests.find((r) => r.path === "/api/v1/authorize")!;
    expect((authorize.body as { arguments: unknown }).arguments).toEqual({
      amount_cents: 4900,
      payment_id: "pi_1",
    });
  });

  it("never chooses between two pinned recipients", async () => {
    const two = [
      { ...SLACK_MANIFEST_ENTRY, resourceConstraints: [{ key: "channel", equals: "C1" }] },
      { ...SLACK_MANIFEST_ENTRY, resourceConstraints: [{ key: "channel", equals: "C2" }] },
    ];
    const { server, task } = await openWith(
      { "POST /api/v1/authorize": () => ({ body: deny(["ARGUMENTS_UNDERSPECIFIED"]) }) },
      { tools: two },
    );
    await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k1" });
    await task.call("slack.post_message", { text: "x", channel: "C2" }, { idempotencyKey: "k2" });
    const bodies = server.requests
      .filter((r) => r.path === "/api/v1/authorize")
      .map((r) => (r.body as { arguments: unknown }).arguments);
    expect(bodies).toEqual([{ text: "x" }, { text: "x", channel: "C2" }]);
    // The manifest is cached per handle.
    expect(server.paths().filter((p) => p.endsWith("/tools"))).toHaveLength(1);
  });

  it("routes github.* tools to the GitHub execute route", async () => {
    const issue = {
      ...SLACK_MANIFEST_ENTRY,
      tool: "github.get_issue",
      resourceConstraints: [{ key: "issue_number", equals: "1" }],
    };
    const { server, task } = await openWith(
      {
        "POST /api/v1/authorize": () => ({ body: allow() }),
        "POST /api/v1/github/execute": () => ({ body: executed }),
      },
      { tools: [issue] },
    );
    const result = await task.call("github.get_issue", {}, { idempotencyKey: "g-1" });
    expect(result.status).toBe("executed");
    expect(server.paths()).toContain("POST /api/v1/github/execute");
  });
});

describe("AuthorityTask.call: decision outcomes", () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["denied", deny(["FORBIDDEN_RESOURCE"]), { reasonCodes: ["FORBIDDEN_RESOURCE"] }],
    [
      "requires_approval",
      deny(["APPROVAL_REQUIRED_BY_POLICY"], {
        requiresApproval: true,
        approval: { id: "ap-1", state: "pending", statusUrl: "/api/v1/approvals/ap-1" },
      }),
      { approvalId: "ap-1", statusUrl: "/api/v1/approvals/ap-1" },
    ],
    ["requires_clarification", deny(["ARGUMENTS_UNDERSPECIFIED"], { requiresClarification: true }), {}],
    ["requires_replan", deny(["CONSTRAINT_VIOLATION"], { requiresReplan: true }), {}],
    [
      "held_for_review",
      deny(["TASK_ALIGNMENT_HELD"], {
        requiresApproval: true,
        alignment: { reviewId: "rv", outcome: "ambiguous", policy: "p", findings: [], feedback: null },
      }),
      { alignment: { outcome: "ambiguous" } },
    ],
    [
      "requires_replan",
      deny(["TASK_ALIGNMENT_MISALIGNED"], {
        requiresReplan: true,
        alignment: { reviewId: "rv", outcome: "misaligned", policy: "p", findings: [], feedback: "no" },
      }),
      { alignment: { outcome: "misaligned" } },
    ],
    [
      "already_authorized",
      allow({
        wasReplayed: true,
        capability: { ...allow().capability, token: null, tokenAlreadyIssued: true },
      }),
      {},
    ],
  ];
  for (const [status, decision, expected] of cases) {
    it(`maps a decision to '${status}' and never executes`, async () => {
      const { server, task } = await openWith({ "POST /api/v1/authorize": () => ({ body: decision }) });
      const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
      expect(result).toMatchObject({ status, ...expected });
      expect(result.guidance).toEqual(decision.guidance);
      expect(server.paths()).not.toContain("POST /api/v1/execute");
    });
  }
});

describe("AuthorityTask.call: execute outcomes are never retried", () => {
  it("result held for review -> result_held", async () => {
    const { task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": () => ({
        body: { ...executed, data: null, delivery: "held", inspection: { status: "held" }, message: "held" },
      }),
    });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({
      status: "result_held",
      receiptId: "rcpt-1",
      inspection: { status: "held" },
    });
  });

  it("504 EXECUTION_INDETERMINATE -> indeterminate, exactly one execute request", async () => {
    const { server, task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": () => ({
        status: 504,
        body: {
          error: { code: "EXECUTION_INDETERMINATE", reason: "DEADLINE_EXCEEDED", message: "unknown" },
          executionId: "exec-9",
          receiptId: "rcpt-9",
        },
      }),
    });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({
      status: "indeterminate",
      cause: "server_reported",
      executionId: "exec-9",
      receiptId: "rcpt-9",
    });
    expect(server.paths().filter((p) => p.endsWith("/execute"))).toHaveLength(1);
  });

  it("a timeout after execute was sent -> indeterminate, with no second execute request", async () => {
    const { server, task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": hang,
    });
    const result = await task.call(
      "slack.post_message",
      { text: "x" },
      { idempotencyKey: "k", timeoutMs: 20 },
    );
    expect(result).toMatchObject({ status: "indeterminate", cause: "timeout" });
    if (result.status === "indeterminate") expect(result.message).toMatch(/may have happened/);
    expect(server.paths().filter((p) => p.endsWith("/execute"))).toHaveLength(1);
  });

  it("an abort after execute was sent -> indeterminate (not cancelled)", async () => {
    const controller = new AbortController();
    const { server, task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": (req, init) => {
        setTimeout(() => controller.abort(), 5);
        return hang(req, init);
      },
    });
    const result = await task.call(
      "slack.post_message",
      { text: "x" },
      { idempotencyKey: "k", signal: controller.signal },
    );
    expect(result).toMatchObject({ status: "indeterminate", cause: "aborted" });
    expect(server.paths().filter((p) => p.endsWith("/execute"))).toHaveLength(1);
  });

  it("a network failure after execute was sent -> indeterminate", async () => {
    const { task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": () => Promise.reject(new TypeError("fetch failed")),
    });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({ status: "indeterminate", cause: "transport_error" });
  });

  it("an abort before execute is sent -> cancelled, and no execute request", async () => {
    const controller = new AbortController();
    const { server, task } = await openWith({
      "POST /api/v1/authorize": () => {
        controller.abort(); // the caller gives up while authorize is answering
        return { body: allow() };
      },
      "POST /api/v1/execute": () => ({ body: executed }),
    });
    const result = await task.call(
      "slack.post_message",
      { text: "x" },
      { idempotencyKey: "k", signal: controller.signal },
    );
    expect(result).toMatchObject({ status: "cancelled", stage: "before_execute", cause: "aborted" });
    expect(server.paths()).not.toContain("POST /api/v1/execute");
  });

  it("an already-aborted signal -> cancelled with no request at all", async () => {
    const controller = new AbortController();
    controller.abort();
    const { server, task } = await openWith({});
    const result = await task.call(
      "slack.post_message",
      { text: "x" },
      { idempotencyKey: "k", signal: controller.signal },
    );
    expect(result).toMatchObject({ status: "cancelled", stage: "before_authorize" });
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it("409 EXECUTION_IN_PROGRESS -> in_progress", async () => {
    const { task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": () => ({
        status: 409,
        body: { error: { code: "EXECUTION_IN_PROGRESS", message: "busy" }, executionId: "exec-2" },
      }),
    });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({ status: "in_progress", executionId: "exec-2" });
  });

  it("502 connector failure (nothing written) -> execution_failed", async () => {
    const { task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": () => ({
        status: 502,
        body: { error: { code: "channel_not_found", reason: "channel_not_found" }, status: "failed" },
      }),
    });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({ status: "execution_failed", code: "channel_not_found", httpStatus: 502 });
  });
});

describe("AuthorityTask.call: sessions", () => {
  it("409 SESSION_CONTRACT_STALE on authorize -> stale_session, nothing re-prepared", async () => {
    const { server, task } = await openWith({
      "POST /api/v1/authorize": () => ({
        status: 409,
        body: { error: { code: "SESSION_CONTRACT_STALE", message: "stale" } },
      }),
    });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({ status: "stale_session", code: "SESSION_CONTRACT_STALE" });
    expect(server.paths().some((p) => p.endsWith("/prepare") || p === "POST /api/v1/sessions")).toBe(false);
  });

  it("409 SESSION_CONTRACT_STALE on execute -> stale_session", async () => {
    const { task } = await openWith({
      "POST /api/v1/authorize": () => ({ body: allow() }),
      "POST /api/v1/execute": () => ({
        status: 409,
        body: { error: { code: "SESSION_CONTRACT_STALE", message: "stale" } },
      }),
    });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({ status: "stale_session" });
  });

  it("401 on authorize -> session_expired (rejected)", async () => {
    const { task } = await openWith({
      "POST /api/v1/authorize": () => ({
        status: 401,
        body: { error: { code: "UNAUTHENTICATED", message: "expired" } },
      }),
    });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({ status: "session_expired", cause: "rejected" });
  });

  it("an expired session returns session_expired without any request", async () => {
    const { server, task } = await openWith({}, { expiresInMs: -1000 });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({ status: "session_expired", cause: "expired" });
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it("close() revokes the session with the task's token; later calls make no request", async () => {
    const { server, task } = await openWith({
      "POST /api/v1/sessions/revoke": () => ({ body: { result: "revoked" } }),
    });
    await task.close("done");
    expect(server.requests[0]).toMatchObject({
      path: "/api/v1/sessions/revoke",
      body: { reason: "done" },
      authorization: `Bearer ${TOKEN}`,
    });
    const result = await task.call("slack.post_message", { text: "x" }, { idempotencyKey: "k" });
    expect(result).toMatchObject({ status: "session_expired", cause: "closed" });
    expect(server.requests).toHaveLength(1);
  });

  it("a missing idempotencyKey is a config error, before any request", async () => {
    const { server, task } = await openWith({});
    await expect(
      task.call("slack.post_message", { text: "x" }, {} as unknown as TaskCallOptions),
    ).rejects.toBeInstanceOf(AuthorityConfigError);
    await expect(
      task.call("slack.post_message", { text: "x" }, undefined as unknown as TaskCallOptions),
    ).rejects.toBeInstanceOf(AuthorityConfigError);
    await expect(
      task.call("slack.post_message", { text: "x" }, { idempotencyKey: "  " }),
    ).rejects.toBeInstanceOf(AuthorityConfigError);
    expect(server.fetch).not.toHaveBeenCalled();
  });
});

describe("AuthorityTask.context", () => {
  it("lists pinned and open inputs per allowed action, from the contract", async () => {
    const { task } = await openWith({});
    const context = await task.context();
    expect(context.actions).toEqual([
      expect.objectContaining({
        tool: "slack.post_message",
        pinned: { channel: "C0ENGINEERING" },
        open: ["text"],
        generated: ["text"],
        remainingInvocations: 1,
      }),
    ]);
  });
});
