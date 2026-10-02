import { describe, expect, it, vi } from "vitest";

import { createCustomApiConnector, type CustomApiConnectorDeps } from "@/lib/connectors/custom-api/connector";
import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";
import { CustomOperationValidationError } from "@/lib/connectors/custom-api/types";
import type { ConnectorExecutionContext } from "@/lib/connectors/types";
import type { ConnectorConnectionConfig } from "@/lib/gateway/rpc-connector-secrets";
import type { PublishedCustomOperation } from "@/lib/gateway/rpc-custom-operations";

const CONNECTOR_ID = "custom_a1b2c3d4e5f64789a0123456789abcde";
const CONNECTION_ID = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
const TOOL = `${CONNECTOR_ID}.get_order`;

function fakeOp(over: Partial<PublishedCustomOperation> = {}): PublishedCustomOperation {
  return {
    operationId: "op-1",
    toolName: TOOL,
    method: "GET",
    pathTemplate: "/v1/orders/{orderId}",
    effect: "read",
    inputSchema: {
      schemaVersion: 1,
      fields: [{ key: "orderId", type: "string", required: true, identifiesResource: true, in: "path" }],
    },
    requestMapping: { schemaVersion: 1 },
    authType: "none",
    authConfig: { schemaVersion: 1 },
    timeoutMs: 8000,
    connectionStatus: "active",
    connectionConfig: { baseUrl: "https://api.example.com" },
    ...over,
  };
}

function fakeResponse(over: Partial<SafeFetchResult> = {}): SafeFetchResult {
  const headers = over.headers ?? new Headers({ "content-type": "application/json" });
  return {
    status: 200,
    bodyText: JSON.stringify({ id: "4821", status: "shipped" }),
    truncated: false,
    ...over,
    headers,
  };
}

function harness(opOver: Partial<PublishedCustomOperation> = {}, over: Partial<CustomApiConnectorDeps> = {}) {
  const op = fakeOp(opOver);
  const fetch = vi.fn(async (_input: SafeFetchInput) => fakeResponse());
  const resolveSecret = vi.fn(async (_connectionId: string, _secretType: string) => "sekret-token");
  const getConnectionConfig = vi.fn(
    async (_connectionId: string): Promise<ConnectorConnectionConfig | null> => ({
      status: "active",
      config: { baseUrl: "https://api.example.com" },
      lastVerifiedAt: "2026-10-01T00:00:00Z",
    }),
  );
  const getPublishedOperation = vi.fn(
    async (_connectionId: string, _slug: string): Promise<PublishedCustomOperation | null> => op,
  );
  const deps: CustomApiConnectorDeps = {
    getPublishedOperation,
    getConnectionConfig,
    resolveSecret,
    fetch,
    ...over,
  };
  const connector = createCustomApiConnector(deps);
  return { connector, deps, fetch, resolveSecret, getConnectionConfig, getPublishedOperation, op };
}

function execContext(over: Partial<ConnectorExecutionContext> = {}): ConnectorExecutionContext {
  return {
    connectionId: CONNECTION_ID,
    taskId: "t1",
    agentId: "a1",
    idempotencyKey: "k1",
    signal: new AbortController().signal,
    beforeWrite: vi.fn(),
    ...over,
  };
}

describe("Custom API connector", () => {
  it("exposes no static operations -- its registry lives in the published-operations table, not here", () => {
    const { connector } = harness();
    expect(connector.describeOperations()).toEqual([]);
  });

  describe("normalizeRequest", () => {
    it("resolves the operation, validates args, and extracts the resource", async () => {
      const { connector } = harness();
      const normalized = await connector.normalizeRequest(TOOL, { orderId: "4821" });
      expect(normalized).toEqual({
        tool: TOOL,
        operation: TOOL,
        resource: "4821",
        args: { orderId: "4821" },
      });
    });

    it("rejects a malformed tool name before ever querying the database", async () => {
      const { connector, getPublishedOperation } = harness();
      await expect(connector.normalizeRequest("not-a-tool-name", {})).rejects.toThrow(
        CustomOperationValidationError,
      );
      expect(getPublishedOperation).not.toHaveBeenCalled();
    });

    it("rejects an operation that is not published (draft, validated-only, or retired all look identical here)", async () => {
      const { connector, getPublishedOperation } = harness();
      getPublishedOperation.mockResolvedValueOnce(null);
      await expect(connector.normalizeRequest(TOOL, { orderId: "4821" })).rejects.toThrow(/not published/i);
    });

    it("rejects path traversal in a path argument", async () => {
      const { connector } = harness();
      await expect(connector.normalizeRequest(TOOL, { orderId: "../secret" })).rejects.toThrow(
        /PATH_TRAVERSAL|path separator/,
      );
    });
  });

  describe("execute (the allowed request)", () => {
    it("calls the resolved base URL and returns the parsed JSON payload", async () => {
      const { connector, fetch } = harness();
      const normalized = await connector.normalizeRequest(TOOL, { orderId: "4821" });
      const result = await connector.execute(normalized, execContext());
      expect(result.category).toBe("succeeded");
      expect(result.agentPayload).toEqual({ id: "4821", status: "shipped" });
      expect(result.resourceIds).toEqual({ resource: "4821" });
      expect(fetch).toHaveBeenCalledTimes(1);
      const call = fetch.mock.calls[0][0];
      expect(call.url.toString()).toBe("https://api.example.com/v1/orders/4821");
    });

    it("never calls beforeWrite for a read operation", async () => {
      const { connector } = harness({ effect: "read" });
      const normalized = await connector.normalizeRequest(TOOL, { orderId: "4821" });
      const ctx = execContext();
      await connector.execute(normalized, ctx);
      expect(ctx.beforeWrite).not.toHaveBeenCalled();
    });

    it("calls beforeWrite before dispatching a write operation", async () => {
      const { connector } = harness({
        effect: "write_update",
        method: "POST",
        pathTemplate: "/v1/orders/{orderId}/cancel",
      });
      const normalized = await connector.normalizeRequest(TOOL, { orderId: "4821" });
      const ctx = execContext();
      await connector.execute(normalized, ctx);
      expect(ctx.beforeWrite).toHaveBeenCalledTimes(1);
    });

    it("resolves a bearer secret and sends it as the Authorization header, never a static one", async () => {
      const { connector, fetch, resolveSecret } = harness({ authType: "bearer" });
      const normalized = await connector.normalizeRequest(TOOL, { orderId: "4821" });
      await connector.execute(normalized, execContext());
      expect(resolveSecret).toHaveBeenCalledWith(CONNECTION_ID, "bearer_token");
      const call = fetch.mock.calls[0][0];
      expect(call.headers.authorization).toBe("Bearer sekret-token");
    });

    it("throws when the resolved connection does not match the execution context's connection (defense in depth, not reachable via a well-formed tool name)", async () => {
      const { connector } = harness();
      const normalized = await connector.normalizeRequest(TOOL, { orderId: "4821" });
      await expect(
        connector.execute(normalized, execContext({ connectionId: "00000000-0000-4000-8000-000000000000" })),
      ).rejects.toMatchObject({ code: "CONNECTION_MISMATCH" });
    });

    it("refuses to dispatch against a non-active connection", async () => {
      const { connector, fetch } = harness({ connectionStatus: "suspended" });
      const normalized = await connector.normalizeRequest(TOOL, { orderId: "4821" });
      await expect(connector.execute(normalized, execContext())).rejects.toMatchObject({
        code: "CONNECTION_UNAVAILABLE",
      });
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("execute (the blocked request)", () => {
    it("treats a non-2xx upstream response as a failure, not a success", async () => {
      const { connector, fetch } = harness();
      fetch.mockResolvedValueOnce(
        fakeResponse({ status: 404, bodyText: JSON.stringify({ error: "not found" }) }),
      );
      const normalized = await connector.normalizeRequest(TOOL, { orderId: "9999" });
      await expect(connector.execute(normalized, execContext())).rejects.toThrow(/UPSTREAM_CLIENT_ERROR/);
    });
  });

  describe("verifyInstallation", () => {
    it("reports disconnected when the connection no longer exists", async () => {
      const { connector, getConnectionConfig } = harness();
      getConnectionConfig.mockResolvedValueOnce(null);
      const health = await connector.verifyInstallation({ connectionId: CONNECTION_ID });
      expect(health.status).toBe("disconnected");
    });

    it("reports not_configured when no base URL is set", async () => {
      const { connector, getConnectionConfig } = harness();
      getConnectionConfig.mockResolvedValueOnce({ status: "active", config: {}, lastVerifiedAt: null });
      const health = await connector.verifyInstallation({ connectionId: CONNECTION_ID });
      expect(health.status).toBe("not_configured");
      expect(health.reasons).toContain("BASE_URL_NOT_CONFIGURED");
    });

    it("reports not_configured when the base URL fails SSRF validation", async () => {
      const { connector, getConnectionConfig } = harness();
      getConnectionConfig.mockResolvedValueOnce({
        status: "active",
        config: { baseUrl: "http://insecure.example.com" },
        lastVerifiedAt: null,
      });
      const health = await connector.verifyInstallation({ connectionId: CONNECTION_ID });
      expect(health.status).toBe("not_configured");
      expect(health.reasons).toContain("BASE_URL_NOT_ALLOWED");
    });

    it("reports active for a healthy connection", async () => {
      const { connector } = harness();
      const health = await connector.verifyInstallation({ connectionId: CONNECTION_ID });
      expect(health.status).toBe("active");
      expect(health.reasons).toEqual([]);
    });
  });
});
