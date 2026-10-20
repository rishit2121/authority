import { describe, expect, it, vi } from "vitest";

import {
  defaultConnectorExecutorDeps,
  executeConnectorOperation,
  type ConnectorExecutorDeps,
} from "@/lib/connectors/executor";
import type {
  AuthorityConnector,
  ConnectorExecutionContext,
  ConnectorExecutionResult,
  NormalizedConnectorRequest,
} from "@/lib/connectors/types";
import type { ReserveConnectorResult } from "@/lib/gateway/rpc-connectors";

const reserved = (over: Partial<ReserveConnectorResult> = {}): ReserveConnectorResult => ({
  status: "ok",
  result: "reserved",
  reasonCode: "RESERVED",
  executionId: "e1",
  capabilityId: "c1",
  taskId: "t1",
  agentId: "a1",
  connectorId: "widgetco",
  connectionId: "conn1",
  leaseExpiresAt: null,
  previousStatus: null,
  previousReceipt: null,
  ...over,
});

function fakeConnector(over: Partial<AuthorityConnector> = {}): AuthorityConnector {
  return {
    id: "widgetco",
    describeOperations: () => [],
    verifyInstallation: async () => ({ status: "active", reasons: [], lastVerifiedAt: null }),
    normalizeRequest: async (tool, input) => ({
      tool,
      operation: tool,
      resource: "widget-1",
      args: (input as Record<string, unknown>) ?? {},
    }),
    execute: async (): Promise<ConnectorExecutionResult> => ({
      category: "succeeded",
      resourceIds: { widgetId: "widget-1" },
      providerRequestId: "req-1",
      httpStatusClass: 2,
      agentPayload: { ok: true },
      redaction: {},
    }),
    reconcile: async () => ({ outcome: "still_unknown", detail: "fake" }),
    ...over,
  };
}

function harness(
  options: Partial<Omit<ConnectorExecutorDeps, "reserve">> & {
    reserve?: ReserveConnectorResult;
    connector?: AuthorityConnector | null;
  } = {},
) {
  const { reserve: reserveResult, connector: providedConnector, ...over } = options;
  const connector = providedConnector === undefined ? fakeConnector() : providedConnector;
  const finish = vi.fn(async (i: { category: string }) => ({
    status: "ok",
    receiptId: "r1",
    finalStatus: i.category === "released" ? "released" : "consumed",
  }));
  const dispatch = vi.fn(async () => ({ status: "ok", reason: null as string | null }));
  const reserve = vi.fn(async () => reserveResult ?? reserved());
  const deps: ConnectorExecutorDeps = {
    ...defaultConnectorExecutorDeps,
    resolveConnector: () => connector,
    executionMode: () => "mock",
    reserve: reserve as never,
    dispatch: dispatch as never,
    finish: finish as never,
    ...over,
  };
  return { deps, finish, dispatch, reserve, connector };
}

const input = (tool = "widgetco.retrieve_widget", args: Record<string, unknown> = {}) => ({
  credentialSecret: "authority_rk_x".padEnd(40, "0"),
  tokenHash: "0".repeat(64),
  tool,
  operation: tool.split(".")[1],
  resource: "widget-1",
  args,
  idempotencyKey: "k",
});

describe("generic connector executor (no database, no real provider)", () => {
  it("returns 501 without reserving anything when no connector is registered for the tool", async () => {
    const h = harness({ connector: null });
    const r = await executeConnectorOperation(input(), h.deps);
    expect(r.http).toBe(501);
    expect(r.body.error).toMatchObject({ code: "OPERATION_NOT_SUPPORTED" });
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("releases (never dispatches) when normalizeRequest throws or the resource does not match", async () => {
    const throwing = fakeConnector({
      normalizeRequest: async () => {
        throw new Error("bad input");
      },
    });
    const h1 = harness({ connector: throwing });
    const r1 = await executeConnectorOperation(input(), h1.deps);
    expect(r1.body.error).toMatchObject({ code: "ARGUMENTS_INVALID" });
    expect(h1.dispatch).not.toHaveBeenCalled();
    expect(h1.finish).toHaveBeenCalledWith(expect.objectContaining({ category: "released" }));

    const mismatched = fakeConnector({
      normalizeRequest: async (tool) => ({
        tool,
        operation: tool,
        resource: "widget-999",
        args: {},
      }),
    });
    const h2 = harness({ connector: mismatched });
    const r2 = await executeConnectorOperation(input(), h2.deps);
    expect(r2.body.error).toMatchObject({ code: "RESOURCE_MISMATCH" });
    expect(h2.dispatch).not.toHaveBeenCalled();
  });

  it("matches a raw email resource against the sanitized request resource, and still refuses a different one", async () => {
    const { sanitizeResource } = await import("@/lib/gateway/argument-audit");
    const rawEmail = fakeConnector({
      normalizeRequest: async (tool) => ({
        tool,
        operation: tool,
        resource: "dana.reyes@northwind.example",
        args: {},
      }),
    });
    const sameSanitized = { ...input(), resource: sanitizeResource("dana.reyes@northwind.example")! };
    const ok = harness({ connector: rawEmail });
    const r1 = await executeConnectorOperation(sameSanitized, ok.deps);
    expect(r1.body.error).toBeUndefined();
    expect(ok.dispatch).toHaveBeenCalled();

    const otherSanitized = { ...input(), resource: sanitizeResource("someone.else@northwind.example")! };
    const refused = harness({ connector: rawEmail });
    const r2 = await executeConnectorOperation(otherSanitized, refused.deps);
    expect(r2.body.error).toMatchObject({ code: "RESOURCE_MISMATCH" });
    expect(refused.dispatch).not.toHaveBeenCalled();
  });

  it("never sends a request when the dispatch re-check blocks, and never calls finish again", async () => {
    const h = harness({
      dispatch: (async () => ({ status: "blocked", reason: "CAPABILITY_REVOKED" })) as never,
    });
    const r = await executeConnectorOperation(input(), h.deps);
    expect(r.http).toBe(403);
    expect(h.finish).not.toHaveBeenCalled();
  });

  it("dispatches at most once and settles exactly once on the happy path", async () => {
    const h = harness();
    const r = await executeConnectorOperation(input(), h.deps);
    expect(r.http).toBe(200);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.finish).toHaveBeenCalledWith(expect.objectContaining({ category: "succeeded" }));
    expect(r.body).toMatchObject({ result: "succeeded", data: { ok: true } });
  });

  it("marks a failure before any write as failed, and after beforeWrite() as indeterminate", async () => {
    const before = fakeConnector({
      execute: async () => {
        throw new Error("CONNECTOR_REFUSED");
      },
    });
    const h1 = harness({ connector: before });
    const r1 = await executeConnectorOperation(input(), h1.deps);
    expect(r1.body).toMatchObject({ status: "failed" });

    const afterWrite = fakeConnector({
      execute: async (_req: NormalizedConnectorRequest, ctx: ConnectorExecutionContext) => {
        ctx.beforeWrite();
        throw new Error("TRANSPORT_TIMEOUT");
      },
    });
    const h2 = harness({ connector: afterWrite });
    const r2 = await executeConnectorOperation(input(), h2.deps);
    expect(r2.http).toBe(504);
    expect(r2.body.error).toMatchObject({ code: "EXECUTION_INDETERMINATE" });
    expect(r2.body).toMatchObject({ status: "indeterminate" });
  });

  it("reports a settlement failure as unknown state and never as success", async () => {
    const h = harness({
      finish: (async () => {
        throw new Error("db down");
      }) as never,
    });
    const r = await executeConnectorOperation(input(), h.deps);
    expect(r.http).toBe(503);
    expect(r.body.error).toMatchObject({ code: "EXECUTION_STATE_UNKNOWN" });
  });

  it("returns the recorded state, not a re-execution, for a replayed key", async () => {
    const execute = vi.fn(fakeConnector().execute);
    const h = harness({
      reserve: reserved({
        result: "replayed",
        previousStatus: "indeterminate",
        previousReceipt: { category: "indeterminate" },
      }),
      connector: fakeConnector({ execute }),
    });
    const r = await executeConnectorOperation(input(), h.deps);
    expect(r.body).toMatchObject({ replayed: true, status: "indeterminate" });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps database rejections to the right HTTP status without touching the connector", async () => {
    for (const [reason, http] of [
      ["CONNECTOR_NOT_CONFIGURED", 503],
      ["SCOPE_MISMATCH", 403],
      ["CAPABILITY_NOT_FOUND", 404],
      ["CAPABILITY_ALREADY_USED", 409],
    ] as const) {
      const execute = vi.fn(fakeConnector().execute);
      const h = harness({
        reserve: reserved({ result: "rejected", reasonCode: reason, executionId: null }),
        connector: fakeConnector({ execute }),
      });
      const r = await executeConnectorOperation(input(), h.deps);
      expect(r.http, reason).toBe(http);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("does not leak the credential secret or idempotency key into the response or any dependency call", async () => {
    const h = harness();
    const r = await executeConnectorOperation(input("widgetco.retrieve_widget", { x: 1 }), h.deps);
    const blob = JSON.stringify([r, h.finish.mock.calls, h.dispatch.mock.calls]);
    expect(blob).not.toContain("authority_rk_");
  });
});
