import { describe, expect, it } from "vitest";

import { runFirstCall, type FetchLike, type FirstCallInput } from "@/lib/setup/first-call";
import { READ_CALLS } from "@/lib/setup/state";

const BASE = "https://authority.example";
const TASK = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CUSTOMER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CONNECTION = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const ATTEMPT = "0b1c2d3e-4f5a-4b6c-8d7e-8f9a0b1c2d3e";

interface Sent {
  path: string;
  auth: string | null;
  body: Record<string, unknown>;
}

type Reply = { status: number; body: unknown } | "throw" | "hang";

/** A scripted API: one reply per path, every request recorded. */
function fakeApi(overrides: Record<string, Reply> = {}) {
  const sent: Sent[] = [];
  const replies: Record<string, Reply> = {
    "/api/v1/customers": { status: 201, body: { customerId: CUSTOMER, wasCreated: true } },
    [`/api/v1/customers/${CUSTOMER}/tasks`]: { status: 201, body: { taskId: TASK, wasCreated: true } },
    [`/api/v1/tasks/${TASK}/prepare`]: {
      status: 200,
      body: { taskId: TASK, status: "ready", tools: ["slack.list_channels"], excludedSteps: [] },
    },
    "/api/v1/sessions": { status: 200, body: { token: "authority_ts_session" } },
    "/api/v1/authorize": {
      status: 200,
      body: {
        status: "allow",
        reasonCodes: ["CONTRACT_MATCH"],
        summary: "Allowed by the task contract.",
        decisionId: "d1",
        capability: { token: "cap_token", tokenAlreadyIssued: false },
      },
    },
    "/api/v1/execute": {
      status: 200,
      body: { result: "succeeded", receiptId: "r-1", data: { channels: [{ id: "C1" }, { id: "C2" }] } },
    },
    "/api/v1/sessions/revoke": { status: 200, body: { result: "revoked" } },
    ...overrides,
  };
  const fetch: FetchLike = async (url, init) => {
    const path = url.slice(BASE.length);
    const headers = init.headers as Record<string, string>;
    sent.push({
      path,
      auth: headers.authorization ?? null,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const reply = replies[path];
    if (!reply) throw new Error(`unexpected request ${path}`);
    if (reply === "throw") throw new TypeError("fetch failed");
    if (reply === "hang") {
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { sent, fetch, paths: () => sent.map((s) => s.path) };
}

function input(fetch: FetchLike, over: Partial<FirstCallInput> = {}): FirstCallInput {
  return {
    baseUrl: BASE,
    backendKey: "authority_dk_backend",
    runtimeKey: "authority_rk_runtime",
    agentId: "agent-1",
    externalId: "authority-setup-user-1",
    call: READ_CALLS.slack,
    connectionId: CONNECTION,
    attemptId: ATTEMPT,
    fetch,
    ...over,
  };
}

describe("runFirstCall", () => {
  it("drives the real runtime path once, with the right keys and bodies", async () => {
    const api = fakeApi();
    const result = await runFirstCall(input(api.fetch));

    expect(result).toMatchObject({
      outcome: "executed",
      taskId: TASK,
      customerId: CUSTOMER,
      receiptId: "r-1",
      summaryOfData: "2 channels",
      decision: {
        status: "allow",
        reasonCodes: ["CONTRACT_MATCH"],
        summary: "Allowed by the task contract.",
      },
    });
    expect(api.paths()).toEqual([
      "/api/v1/customers",
      `/api/v1/customers/${CUSTOMER}/tasks`,
      `/api/v1/tasks/${TASK}/prepare`,
      "/api/v1/sessions",
      "/api/v1/authorize",
      "/api/v1/execute",
      "/api/v1/sessions/revoke",
    ]);
    const [customer, task, prepare, session, authorize, execute, revoke] = api.sent;

    expect(customer!.auth).toBe("Bearer authority_dk_backend");
    expect(customer!.body).toMatchObject({ externalId: "authority-setup-user-1" });

    // Exactly one connection bound, and the setup idempotency key.
    expect(task!.auth).toBe("Bearer authority_dk_backend");
    expect(task!.body.connections).toEqual([{ connectorId: "slack", connectionId: CONNECTION }]);
    expect(task!.body.idempotencyKey).toBe(`setup-${ATTEMPT}`);
    expect(task!.body.agentId).toBe("agent-1");

    // A fixed one-node plan, never `generate`.
    expect(prepare!.body).not.toHaveProperty("generate");
    expect(prepare!.body.plan).toEqual({
      schemaVersion: 1,
      taskId: TASK,
      nodes: [
        {
          id: "setup-read",
          sequence: 0,
          tool: "slack.list_channels",
          arguments: {},
          dependencies: [],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: "read",
          maxInvocations: 1,
        },
      ],
    });

    expect(session!.auth).toBe("Bearer authority_rk_runtime");
    expect(session!.body).toEqual({ taskId: TASK, ttlSeconds: 120 });

    expect(authorize!.auth).toBe("Bearer authority_ts_session");
    expect(authorize!.body).toEqual({
      taskId: TASK,
      tool: "slack.list_channels",
      operation: "list_channels",
      arguments: {},
      idempotencyKey: `setup-${ATTEMPT}-call`,
    });
    expect(execute!.auth).toBe("Bearer authority_ts_session");
    expect(execute!.body).toEqual({
      capability: "cap_token",
      tool: "slack.list_channels",
      operation: "list_channels",
      arguments: {},
      idempotencyKey: `setup-${ATTEMPT}-call`,
    });
    expect(revoke!.auth).toBe("Bearer authority_ts_session");
  });

  it("returns only a count, never provider content", async () => {
    const api = fakeApi({
      "/api/v1/execute": {
        status: 200,
        body: { result: "succeeded", receiptId: "r-2", data: { labels: [{ name: "Private label" }] } },
      },
      [`/api/v1/tasks/${TASK}/prepare`]: {
        status: 200,
        body: { status: "ready", tools: ["gmail.list_labels"] },
      },
    });
    const result = await runFirstCall(input(api.fetch, { call: READ_CALLS.gmail }));
    expect(result.summaryOfData).toBe("1 label");
    expect(JSON.stringify(result)).not.toContain("Private label");
    expect(api.sent[1]!.body.connections).toEqual([{ connectorId: "gmail", connectionId: CONNECTION }]);
  });

  it("maps a connection the setup customer cannot use to needs_access, with no call made", async () => {
    const api = fakeApi({
      [`/api/v1/customers/${CUSTOMER}/tasks`]: {
        status: 403,
        body: { error: { code: "CONNECTION_NOT_USABLE_BY_CUSTOMER" } },
      },
    });
    const result = await runFirstCall(input(api.fetch));
    expect(result.outcome).toBe("needs_access");
    expect(result.decision).toBeNull();
    expect(api.paths()).toEqual(["/api/v1/customers", `/api/v1/customers/${CUSTOMER}/tasks`]);
  });

  it("maps a prepare that is not ready to not_ready, and never opens a session", async () => {
    const api = fakeApi({
      [`/api/v1/tasks/${TASK}/prepare`]: {
        status: 200,
        body: { status: "awaiting_approval", contractId: "c" },
      },
    });
    const result = await runFirstCall(input(api.fetch));
    expect(result).toMatchObject({ outcome: "not_ready", preparedStatus: "awaiting_approval" });
    expect(api.paths()).not.toContain("/api/v1/sessions");
  });

  it("treats a ready plan that left the read tool out as not ready (partial)", async () => {
    const api = fakeApi({
      [`/api/v1/tasks/${TASK}/prepare`]: { status: 200, body: { status: "ready", tools: [] } },
    });
    expect(await runFirstCall(input(api.fetch))).toMatchObject({
      outcome: "not_ready",
      preparedStatus: "partial",
    });
  });

  it("maps a refusal to blocked_before_dispatch and never executes", async () => {
    const api = fakeApi({
      "/api/v1/authorize": {
        status: 200,
        body: { status: "deny", reasonCodes: ["CONSTRAINT_VIOLATION"], summary: "No.", capability: null },
      },
    });
    const result = await runFirstCall(input(api.fetch));
    expect(result).toMatchObject({
      outcome: "blocked_before_dispatch",
      decision: { status: "deny", reasonCodes: ["CONSTRAINT_VIOLATION"] },
    });
    expect(api.paths()).not.toContain("/api/v1/execute");
    expect(api.paths().at(-1)).toBe("/api/v1/sessions/revoke");
  });

  it("does not execute again when this attempt's capability was already issued", async () => {
    const api = fakeApi({
      "/api/v1/authorize": {
        status: 200,
        body: {
          status: "allow",
          reasonCodes: [],
          summary: "",
          capability: { token: null, tokenAlreadyIssued: true },
        },
      },
    });
    const result = await runFirstCall(input(api.fetch));
    expect(result.outcome).toBe("indeterminate");
    expect(api.paths()).not.toContain("/api/v1/execute");
  });

  it("reports a 504 from execute as indeterminate and does not retry", async () => {
    const api = fakeApi({
      "/api/v1/execute": {
        status: 504,
        body: { error: { code: "EXECUTION_INDETERMINATE" }, receiptId: "r-x" },
      },
    });
    const result = await runFirstCall(input(api.fetch));
    expect(result.outcome).toBe("indeterminate");
    expect(result.detail).toMatch(/may have run/i);
    expect(api.paths().filter((p) => p === "/api/v1/execute")).toHaveLength(1);
  });

  it("reports a timeout after execute was sent as indeterminate and does not retry", async () => {
    const api = fakeApi({ "/api/v1/execute": "hang" });
    const result = await runFirstCall(input(api.fetch, { timeoutMs: 30 }));
    expect(result.outcome).toBe("indeterminate");
    expect(result.detail).toMatch(/timed out.*may have run.*not retried/i);
    expect(api.paths().filter((p) => p === "/api/v1/execute")).toHaveLength(1);
    // The session is still revoked.
    expect(api.paths().at(-1)).toBe("/api/v1/sessions/revoke");
  });

  it("reports a lost response from execute as indeterminate", async () => {
    const api = fakeApi({ "/api/v1/execute": "throw" });
    const result = await runFirstCall(input(api.fetch));
    expect(result.outcome).toBe("indeterminate");
    expect(api.paths().filter((p) => p === "/api/v1/execute")).toHaveLength(1);
  });

  it("a timeout BEFORE execute is a plain failure (nothing could have run), not retried", async () => {
    const api = fakeApi({ "/api/v1/authorize": "hang" });
    const result = await runFirstCall(input(api.fetch, { timeoutMs: 30 }));
    expect(result.outcome).toBe("failed");
    expect(api.paths().filter((p) => p === "/api/v1/authorize")).toHaveLength(1);
    expect(api.paths()).not.toContain("/api/v1/execute");
  });

  it("maps a held result to result_held, with no data summary", async () => {
    const api = fakeApi({
      "/api/v1/execute": {
        status: 200,
        body: { result: "succeeded", receiptId: "r-h", data: null, delivery: "held" },
      },
    });
    const result = await runFirstCall(input(api.fetch));
    expect(result).toMatchObject({ outcome: "result_held", receiptId: "r-h", summaryOfData: null });
  });

  it("maps a provider failure to failed, once", async () => {
    const api = fakeApi({
      "/api/v1/execute": { status: 502, body: { error: { code: "PROVIDER_ERROR" }, receiptId: "r-f" } },
    });
    const result = await runFirstCall(input(api.fetch));
    expect(result).toMatchObject({ outcome: "failed", receiptId: "r-f" });
    expect(api.paths().filter((p) => p === "/api/v1/execute")).toHaveLength(1);
  });

  it("never puts a key in what it returns", async () => {
    const api = fakeApi();
    const text = JSON.stringify(await runFirstCall(input(api.fetch)));
    expect(text).not.toMatch(/authority_(dk|rk|ts)_/);
    expect(text).not.toContain("cap_token");
  });
});
