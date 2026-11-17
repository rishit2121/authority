// @vitest-environment node
import { describe, expect, it } from "vitest";

import { Authority, type PrepareTaskRequest } from "../../../../packages/authority-sdk/src/authority";
import { AuthorityConfigError } from "../../../../packages/authority-sdk/src/errors";
import { AGENT_ID, TASK_B, TASK_ID, fakeAuthority, manifest, session, type FakeHandler } from "./support";

const BACKEND_KEY = "authority_dk_backend";
const RUNTIME_KEY = "authority_rk_runtime";

function readyOutcome(overrides: Record<string, unknown> = {}) {
  return {
    taskId: TASK_ID,
    status: "ready",
    contractId: "contract-1",
    version: 1,
    tools: ["slack.post_message"],
    excludedSteps: [],
    budgets: "inherited",
    ...overrides,
  };
}

function backendRoutes(prepare: FakeHandler, extra: Record<string, FakeHandler> = {}) {
  return fakeAuthority({
    "POST /api/v1/customers": () => ({ body: { customerId: "cust-1", wasCreated: true } }),
    "POST /api/v1/customers/cust-1/tasks": () => ({
      status: 201,
      body: { taskId: TASK_ID, wasCreated: true },
    }),
    [`POST /api/v1/tasks/${TASK_ID}/prepare`]: prepare,
    "POST /api/v1/sessions": () => ({ body: session(TASK_ID, "authority_ts_A") }),
    ...extra,
  });
}

function authorityWith(fetch: ReturnType<typeof fakeAuthority>["fetch"]) {
  return new Authority({
    baseUrl: "https://authority.example",
    backendKey: BACKEND_KEY,
    agentId: AGENT_ID,
    runtimeKey: RUNTIME_KEY,
    fetch,
  });
}

const SLACK_INPUT: PrepareTaskRequest = {
  userId: "user-1",
  request: "Post one engineering update",
  connections: { slack: "44444444-4444-4444-8444-444444444444" },
  actions: [
    {
      tool: "slack.post_message",
      arguments: { channel: "C0ENGINEERING" },
      agentGenerated: ["text"],
      maxInvocations: 1,
    },
  ],
  idempotencyKey: "evt-1",
};

describe("Authority.prepareTask: request bodies (compatibility)", () => {
  it("sends exactly these bodies, with the right credential for each step", async () => {
    const server = backendRoutes(() => ({ body: readyOutcome() }));
    const result = await authorityWith(server.fetch).prepareTask(SLACK_INPUT);

    expect(server.paths()).toEqual([
      "POST /api/v1/customers",
      "POST /api/v1/customers/cust-1/tasks",
      `POST /api/v1/tasks/${TASK_ID}/prepare`,
      "POST /api/v1/sessions",
    ]);
    const [customer, task, prepare, sessionReq] = server.requests;
    expect(customer!.body).toEqual({ externalId: "user-1" });
    expect(task!.body).toEqual({
      agentId: AGENT_ID,
      intent: "Post one engineering update",
      connections: [{ connectorId: "slack", connectionId: "44444444-4444-4444-8444-444444444444" }],
      idempotencyKey: "evt-1:task",
    });
    expect(prepare!.body).toEqual({
      plan: {
        schemaVersion: 1,
        taskId: TASK_ID,
        nodes: [
          {
            id: "a1",
            sequence: 0,
            tool: "slack.post_message",
            arguments: { channel: "C0ENGINEERING" },
            dependencies: [],
            declaredOutputs: [],
            dataFlowRefs: [],
            agentGenerated: ["text"],
            expectedSideEffect: "write_create",
            maxInvocations: 1,
          },
        ],
      },
      idempotencyKey: "evt-1:prepare",
    });
    expect(prepare!.body).not.toHaveProperty("raiseBudgets");
    expect(sessionReq!.body).toEqual({ taskId: TASK_ID });

    for (const r of [customer, task, prepare]) expect(r!.authorization).toBe(`Bearer ${BACKEND_KEY}`);
    expect(sessionReq!.authorization).toBe(`Bearer ${RUNTIME_KEY}`);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.task.taskId).toBe(TASK_ID);
    expect(result.excludedSteps).toEqual([]);
    expect(result.budgets).toBe("inherited");
  });

  it("numbers multi-action plans a1..an with sequence 0..n-1 and sends raiseBudgets and ttl only when set", async () => {
    const server = backendRoutes(() => ({ body: readyOutcome({ budgets: "raised" }) }));
    await authorityWith(server.fetch)
      .prepareTask({
        ...SLACK_INPUT,
        connections: { ...SLACK_INPUT.connections, gmail: "55555555-5555-4555-8555-555555555555" },
        actions: [
          { tool: "gmail.list_labels" },
          {
            tool: "slack.post_message",
            arguments: { channel: "C1" },
            agentGenerated: ["text"],
            maxInvocations: 2,
          },
          { tool: "custom_abc.lookup", expectedSideEffect: "read", resourceBinding: "orders" },
        ],
        raiseBudgets: true,
        sessionTtlSeconds: 120,
      })
      .catch(() => undefined);
    // custom_abc has no connection -> config error, nothing sent.
    expect(server.requests).toHaveLength(0);

    await authorityWith(server.fetch).prepareTask({
      ...SLACK_INPUT,
      connections: {
        ...SLACK_INPUT.connections,
        gmail: "55555555-5555-4555-8555-555555555555",
        custom_abc: "x",
      },
      actions: [
        { tool: "gmail.list_labels" },
        {
          tool: "slack.post_message",
          arguments: { channel: "C1" },
          agentGenerated: ["text"],
          maxInvocations: 2,
        },
        { tool: "custom_abc.lookup", expectedSideEffect: "read", resourceBinding: "orders" },
      ],
      raiseBudgets: true,
      sessionTtlSeconds: 120,
    });
    const prepare = server.requests.find((r) => r.path.endsWith("/prepare"))!.body as {
      plan: { nodes: Array<Record<string, unknown>> };
      raiseBudgets?: boolean;
    };
    expect(prepare.raiseBudgets).toBe(true);
    expect(prepare.plan.nodes.map((n) => [n.id, n.sequence, n.expectedSideEffect, n.maxInvocations])).toEqual(
      [
        ["a1", 0, "read", 1],
        ["a2", 1, "write_create", 2],
        ["a3", 2, "read", 1],
      ],
    );
    expect(prepare.plan.nodes[0]).not.toHaveProperty("agentGenerated");
    expect(prepare.plan.nodes[2]!.resourceBinding).toBe("orders");
    const task = server.requests.find((r) => r.path.endsWith("/tasks"))!.body as { connections: unknown[] };
    expect(task.connections).toEqual([
      { connectorId: "slack", connectionId: "44444444-4444-4444-8444-444444444444" },
      { connectorId: "gmail", connectionId: "55555555-5555-4555-8555-555555555555" },
      { connectorId: "custom_abc", connectionId: "x" },
    ]);
    expect(server.requests.find((r) => r.path === "/api/v1/sessions")!.body).toEqual({
      taskId: TASK_ID,
      ttlSeconds: 120,
    });
  });

  it("derives a stable default idempotency key from the request, and a different one for a different request", async () => {
    const server = backendRoutes(() => ({ body: readyOutcome() }));
    const authority = authorityWith(server.fetch);
    const { idempotencyKey: _omit, ...input } = SLACK_INPUT;
    await authority.prepareTask(input);
    await authority.prepareTask(input);
    await authority.prepareTask({ ...input, request: "Post a different update" });
    const keys = server.requests
      .filter((r) => r.path.endsWith("/tasks"))
      .map((r) => (r.body as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toMatch(/^sdk_[0-9a-f]{48}:task$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("binds a GitHub repository instead of a connection, tolerating ALREADY_BOUND on retry", async () => {
    const server = backendRoutes(() => ({ body: readyOutcome({ tools: ["github.get_issue"] }) }), {
      [`POST /api/v1/tasks/${TASK_ID}/github-repository`]: () => ({
        status: 409,
        body: { error: { code: "ALREADY_BOUND", message: "bound" } },
      }),
    });
    const result = await authorityWith(server.fetch).prepareTask({
      userId: "user-1",
      request: "Read issue 1",
      connections: {},
      githubRepositoryId: "repo-1",
      actions: [{ tool: "github.get_issue", arguments: { issue_number: "1" } }],
      idempotencyKey: "gh-1",
    });
    expect(result.status).toBe("ready");
    const bind = server.requests.find((r) => r.path.endsWith("/github-repository"))!;
    expect(bind.body).toEqual({ repositoryId: "repo-1" });
  });
});

describe("Authority.prepareTask: validation happens before any request", () => {
  const cases: Array<[string, Partial<PrepareTaskRequest>]> = [
    ["an action whose provider has no connection", { connections: {} }],
    [
      "an unknown tool without expectedSideEffect",
      { connections: { custom_x: "c" }, actions: [{ tool: "custom_x.do_thing" }] },
    ],
    ["a GitHub action without githubRepositoryId", { actions: [{ tool: "github.get_issue" }] }],
    ["connections.github", { connections: { github: "c", slack: "s" } }],
    ["a malformed tool name", { actions: [{ tool: "post_message" }] }],
    ["no actions", { actions: [] }],
    ["maxInvocations out of range", { actions: [{ tool: "slack.post_message", maxInvocations: 0 }] }],
    [
      "a key both pinned and agentGenerated",
      { actions: [{ tool: "slack.post_message", arguments: { text: "x" }, agentGenerated: ["text"] }] },
    ],
    ["an empty userId", { userId: "" }],
    ["a session TTL out of range", { sessionTtlSeconds: 30 }],
    ["an over-long idempotency key", { idempotencyKey: "k".repeat(181) }],
  ];
  for (const [name, patch] of cases) {
    it(`rejects ${name} with AuthorityConfigError and sends nothing`, async () => {
      const server = backendRoutes(() => ({ body: readyOutcome() }));
      await expect(
        authorityWith(server.fetch).prepareTask({ ...SLACK_INPUT, ...patch }),
      ).rejects.toBeInstanceOf(AuthorityConfigError);
      expect(server.fetch).not.toHaveBeenCalled();
    });
  }

  it("rejects a constructor without credentials", () => {
    expect(
      () =>
        new Authority({ baseUrl: "https://a.example", backendKey: "", agentId: AGENT_ID, runtimeKey: "r" }),
    ).toThrow(AuthorityConfigError);
    expect(
      () => new Authority({ baseUrl: "not a url", backendKey: "b", agentId: AGENT_ID, runtimeKey: "r" }),
    ).toThrow(AuthorityConfigError);
  });
});

describe("Authority.prepareTask: outcomes", () => {
  const excluded = [{ nodeId: "a2", tool: "gmail.send_email", status: "denied", reasons: ["x"] }];

  it("a partially accepted plan returns 'partial' and opens no session", async () => {
    const server = backendRoutes(() => ({ body: readyOutcome({ excludedSteps: excluded }) }));
    const result = await authorityWith(server.fetch).prepareTask(SLACK_INPUT);
    expect(result.status).toBe("partial");
    expect(result).not.toHaveProperty("task");
    if (result.status === "partial") expect(result.excludedSteps).toEqual(excluded);
    expect(server.paths()).not.toContain("POST /api/v1/sessions");
  });

  it("allowPartial: true opens the narrower contract deliberately", async () => {
    const server = backendRoutes(() => ({ body: readyOutcome({ excludedSteps: excluded }) }));
    const result = await authorityWith(server.fetch).prepareTask({ ...SLACK_INPUT, allowPartial: true });
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.excludedSteps).toEqual(excluded);
    expect(server.paths()).toContain("POST /api/v1/sessions");
  });

  const nonReady: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    [
      "awaiting_approval",
      {
        status: "awaiting_approval",
        contractId: "c1",
        version: 1,
        approvalPath: "/tasks/x",
        excludedSteps: [],
        budgets: "raise_on_activation",
      },
      { approvalPath: "/tasks/x", contractId: "c1", budgets: "raise_on_activation" },
    ],
    [
      "alignment_review",
      {
        status: "alignment_review",
        decision: "hold",
        contractId: "c1",
        version: 1,
        reviewPath: "/review",
        excludedSteps: [],
        alignment: { mode: "enforce", outcome: "ambiguous", findings: [] },
        budgets: "inherited",
      },
      {
        decision: "hold",
        reviewPath: "/review",
        alignment: { mode: "enforce", outcome: "ambiguous", findings: [] },
      },
    ],
    [
      "clarification",
      { status: "clarification", reason: "missing channel", details: { field: "channel" } },
      { reason: "missing channel", details: { field: "channel" } },
    ],
    ["rejected", { status: "rejected", reason: "not allowed" }, { reason: "not allowed" }],
    ["ai_unavailable", { status: "ai_unavailable" }, {}],
  ];
  for (const [status, body, expected] of nonReady) {
    it(`maps '${status}' first-class, with no session and no re-prepare`, async () => {
      const server = backendRoutes(() => ({ body: { taskId: TASK_ID, ...body } }));
      const result = await authorityWith(server.fetch).prepareTask(SLACK_INPUT);
      expect(result).toMatchObject({ status, taskId: TASK_ID, customerId: "cust-1", ...expected });
      expect(result).not.toHaveProperty("task");
      expect(server.paths().filter((p) => p.endsWith("/prepare"))).toHaveLength(1);
      expect(server.paths()).not.toContain("POST /api/v1/sessions");
    });
  }
});

describe("Authority.openTask: independent, immutable handles", () => {
  function twoTaskServer() {
    return fakeAuthority({
      "POST /api/v1/sessions": (req) => {
        const taskId = (req.body as { taskId: string }).taskId;
        return { body: session(taskId, taskId === TASK_ID ? "authority_ts_A" : "authority_ts_B") };
      },
      "GET /api/v1/tasks/*": (req) => ({ body: manifest(req.path.split("/")[4]!) }),
      "POST /api/v1/authorize": () => ({ body: denyBody() }),
    });
  }
  function denyBody() {
    return {
      decisionId: "d",
      status: "deny",
      reasonCodes: ["TOOL_NOT_IN_CONTRACT"],
      summary: "no",
      requiresApproval: false,
      requiresClarification: false,
      requiresReplan: false,
      capability: null,
      approval: null,
      guidance: { nextStep: "stop", message: "no" },
    };
  }

  it("task A keeps using A's own token after task B is opened; the runtime key is never sent to authorize", async () => {
    const server = twoTaskServer();
    const authority = authorityWith(server.fetch);
    const a = await authority.openTask(TASK_ID);
    const b = await authority.openTask(TASK_B);
    await a.call("slack.post_message", { text: "hi" }, { idempotencyKey: "a-1" });
    await b.call("slack.post_message", { text: "hi" }, { idempotencyKey: "b-1" });
    await a.call("slack.post_message", { text: "again" }, { idempotencyKey: "a-2" });

    const authorizes = server.requests.filter((r) => r.path === "/api/v1/authorize");
    expect(authorizes.map((r) => [(r.body as { taskId: string }).taskId, r.authorization])).toEqual([
      [TASK_ID, "Bearer authority_ts_A"],
      [TASK_B, "Bearer authority_ts_B"],
      [TASK_ID, "Bearer authority_ts_A"],
    ]);
    for (const r of server.requests.filter((r) => r.path !== "/api/v1/sessions")) {
      expect(r.authorization).not.toBe(`Bearer ${RUNTIME_KEY}`);
    }
  });

  it("the handle is frozen and never serializes its token", async () => {
    const server = twoTaskServer();
    const task = await authorityWith(server.fetch).openTask(TASK_ID);
    expect(Object.isFrozen(task)).toBe(true);
    expect(Object.isFrozen(task.contract)).toBe(true);
    expect(() => {
      (task as unknown as { taskId: string }).taskId = TASK_B;
    }).toThrow(TypeError);
    expect(task.taskId).toBe(TASK_ID);
    expect(JSON.stringify(task)).not.toContain("authority_ts_A");
    expect(Object.values(task).join(" ")).not.toContain("authority_ts_A");
  });

  it("the Authority instance is frozen and its low-level agent client factory returns a fresh client each time", () => {
    const authority = authorityWith(fakeAuthority({}).fetch);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(authority.lowLevel.createAgentClient()).not.toBe(authority.lowLevel.createAgentClient());
    expect(authority.lowLevel.backend).toBe(authority.backend);
  });

  it("mcp() returns the task-bound URL and headers", async () => {
    const task = await authorityWith(twoTaskServer().fetch).openTask(TASK_ID);
    expect(task.mcp()).toEqual({
      url: `https://authority.example/api/mcp/tasks/${TASK_ID}`,
      headers: { Authorization: "Bearer authority_ts_A", Accept: "application/json, text/event-stream" },
    });
  });
});
