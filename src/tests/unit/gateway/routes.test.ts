import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EXPECTED_SCHEMA_VERSION } from "@/lib/gateway/schema-version";
import type * as PipelineModule from "@/lib/gateway/pipeline";
import type * as RpcModule from "@/lib/gateway/rpc";

const authorizeThroughGateway = vi.fn();
const consumeCapability = vi.fn();
const revokeCapabilityViaGateway = vi.fn();
const gatewayPing = vi.fn();
const schemaVersion = vi.fn();
// Falls back to the GitHub-fixture-only registry/registryVersion (see the
// route's own `tenantId ? ... : null` guard) -- these tests exercise routing
// and error-mapping, not tenant-scoped registry assembly.
const tenantForTask = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/gateway/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof PipelineModule>();
  return { ...actual, authorizeThroughGateway };
});
vi.mock("@/lib/gateway/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof RpcModule>();
  return { ...actual, consumeCapability, revokeCapabilityViaGateway, gatewayPing, tenantForTask };
});
vi.mock("@/lib/maintenance/db", () => ({ schemaVersion }));

const TASK = "00000000-0000-4000-8000-000000000001";
const KEY = "authority_rk_" + "ab".repeat(32);
const CAP = "authcap_v1_" + "A".repeat(43);

const req = (
  path: string,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${KEY}` },
) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const goodBody = {
  taskId: TASK,
  tool: "github.get_issue",
  operation: "get_issue",
  idempotencyKey: "k1",
  arguments: { issue_number: "1" },
};

const decision = (over = {}) => ({
  kind: "decision",
  capabilityToken: CAP,
  riskClass: "low",
  commit: {
    status: "ok",
    replayed: false,
    decisionId: "d1",
    finalDecisionId: "f1",
    toolRequestId: "t1",
    detOutcome: "allow",
    finalOutcome: "allow",
    reasonCodes: ["WITHIN_CONTRACT"],
    contractId: "c1",
    contractVersion: 1,
    semanticMode: "enforce",
    semanticPolicy: "optional",
    degraded: false,
    degradedReason: null,
    narrowed: false,
    capabilityId: "cap1",
    capabilityExpiresAt: "2026-01-01T00:01:00.000Z",
    capabilityMaxUses: 1,
    remainingInvocations: 4,
    ...over,
  },
});

beforeEach(() => vi.clearAllMocks());

describe("POST /api/v1/authorize", () => {
  it("issues the capability once, with no-store caching and a request id", async () => {
    authorizeThroughGateway.mockResolvedValue(decision());
    const { POST } = await import("@/app/api/v1/authorize/route");
    const res = await POST(req("/api/v1/authorize", goodBody));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const body = await res.json();
    expect(body.capability.token).toBe(CAP);
    expect(body.simulation).toBe(false); // github.* is executed by a real connector
  });

  it("returns nothing of the semantic evidence or internal policy to the agent", async () => {
    authorizeThroughGateway.mockResolvedValue(
      decision({
        finalOutcome: "deny",
        narrowed: true,
        reasonCodes: ["SEMANTIC_CRITICAL_RISK"],
        capabilityId: null,
      }),
    );
    const { POST } = await import("@/app/api/v1/authorize/route");
    const text = await (await POST(req("/api/v1/authorize", goodBody))).text();
    expect(text).not.toMatch(/SEMANTIC_|signals|indicators|promptInjection|provider/);
  });

  it("never echoes the bearer key", async () => {
    authorizeThroughGateway.mockResolvedValue(decision());
    const { POST } = await import("@/app/api/v1/authorize/route");
    const text = await (await POST(req("/api/v1/authorize", goodBody))).text();
    expect(text).not.toContain(KEY);
  });

  it("rejects a missing Authorization header with 401 and never touches the gateway", async () => {
    const { POST } = await import("@/app/api/v1/authorize/route");
    const res = await POST(req("/api/v1/authorize", goodBody, {}));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    expect(authorizeThroughGateway).not.toHaveBeenCalled();
  });

  it.each([
    ["a tenant id", { ...goodBody, tenantId: "x" }],
    ["a principal id", { ...goodBody, principalId: "x" }],
    ["a contract status", { ...goodBody, contractStatus: "active" }],
    ["a policy result", { ...goodBody, policyResult: "allow" }],
    ["a permission result", { ...goodBody, permission: "granted" }],
    ["a semantic result", { ...goodBody, semantic: { riskLevel: "low" } }],
  ])("refuses a request that supplies %s", async (_n, body) => {
    const { POST } = await import("@/app/api/v1/authorize/route");
    const res = await POST(req("/api/v1/authorize", body));
    expect(res.status).toBe(400);
    expect(authorizeThroughGateway).not.toHaveBeenCalled();
  });

  it("validation errors name field paths only, never the offending values", async () => {
    const { POST } = await import("@/app/api/v1/authorize/route");
    const res = await POST(
      req("/api/v1/authorize", { ...goodBody, tool: "NOT A TOOL ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6" }),
    );
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toContain("ghp_");
    expect(text).not.toContain("NOT A TOOL");
  });

  it("returns 413 for an oversized body and 400 for malformed JSON", async () => {
    const { POST } = await import("@/app/api/v1/authorize/route");
    const big = await POST(req("/api/v1/authorize", { ...goodBody, arguments: { a: "x".repeat(70_000) } }));
    expect(big.status).toBe(413);
    const bad = await POST(req("/api/v1/authorize", "{not json"));
    expect(bad.status).toBe(400);
  });

  it("maps gateway failures to the stable contract, including Retry-After on 429", async () => {
    const { POST } = await import("@/app/api/v1/authorize/route");
    authorizeThroughGateway.mockResolvedValue({ kind: "failure", status: "rate_limited" });
    const limited = await POST(req("/api/v1/authorize", goodBody));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    authorizeThroughGateway.mockResolvedValue({ kind: "failure", status: "idempotency_conflict" });
    expect((await POST(req("/api/v1/authorize", goodBody))).status).toBe(409);
    authorizeThroughGateway.mockResolvedValue({ kind: "failure", status: "invalid_credential" });
    expect((await POST(req("/api/v1/authorize", goodBody))).status).toBe(401);
  });

  it("returns 503 when the gateway is unavailable, without detail", async () => {
    const { GatewayNotConfiguredError } = await import("@/lib/gateway/db");
    authorizeThroughGateway.mockRejectedValue(new GatewayNotConfiguredError());
    const { POST } = await import("@/app/api/v1/authorize/route");
    const res = await POST(req("/api/v1/authorize", goodBody));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("GATEWAY_UNAVAILABLE");
  });

  it("maps an unexpected error to a generic 500", async () => {
    authorizeThroughGateway.mockRejectedValue(
      new Error("boom with ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6"),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/v1/authorize/route");
    const res = await POST(req("/api/v1/authorize", goodBody));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("ghp_");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("ghp_");
    spy.mockRestore();
  });
});

describe("POST /api/v1/capabilities/consume", () => {
  it.each([
    "stripe.issue_refund",
    "slack.post_message",
    "gmail.send_email",
    "custom_0123456789abcdef0123456789abcdef.create_order",
  ])("refuses to simulate a connector-executed tool (%s) without touching the capability", async (tool) => {
    consumeCapability.mockReset();
    const { POST } = await import("@/app/api/v1/capabilities/consume/route");
    const res = await POST(
      req("/api/v1/capabilities/consume", {
        capability: CAP,
        tool,
        operation: "op",
        idempotencyKey: "cx",
        arguments: {},
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONNECTOR_EXECUTION_REQUIRED");
    expect(consumeCapability).not.toHaveBeenCalled();
  });

  const body = {
    capability: CAP,
    tool: "github.get_issue",
    operation: "get_issue",
    idempotencyKey: "c1",
    arguments: { issue_number: "1" },
  };

  it("accepts and labels the result as simulated", async () => {
    consumeCapability.mockResolvedValue({
      status: "ok",
      result: "accepted",
      reasonCode: "ACCEPTED",
      capabilityId: "cap1",
      remainingUses: 0,
      expiresAt: "x",
      replayed: false,
    });
    const { POST } = await import("@/app/api/v1/capabilities/consume/route");
    const res = await POST(req("/api/v1/capabilities/consume", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      result: "accepted",
      simulated: true,
      message: expect.stringContaining("no external tool"),
    });
  });

  it("hashes the capability before it reaches the gateway", async () => {
    consumeCapability.mockResolvedValue({
      status: "ok",
      result: "accepted",
      reasonCode: "ACCEPTED",
      capabilityId: "c",
      remainingUses: 0,
      expiresAt: "x",
      replayed: false,
    });
    const { POST } = await import("@/app/api/v1/capabilities/consume/route");
    await POST(req("/api/v1/capabilities/consume", body));
    const sent = consumeCapability.mock.calls[0][0];
    expect(sent.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(sent)).not.toContain(CAP);
  });

  it.each([
    ["CAPABILITY_NOT_FOUND", 404],
    ["SCOPE_MISMATCH", 403],
    ["CAPABILITY_ALREADY_USED", 409],
    ["CAPABILITY_EXPIRED", 409],
    ["CAPABILITY_REVOKED", 409],
    ["IDEMPOTENCY_CONFLICT", 409],
  ])("rejection %s -> %s", async (code, http) => {
    consumeCapability.mockResolvedValue({
      status: "ok",
      result: "rejected",
      reasonCode: code,
      capabilityId: "c",
      remainingUses: 0,
      expiresAt: "x",
      replayed: false,
    });
    const { POST } = await import("@/app/api/v1/capabilities/consume/route");
    const res = await POST(req("/api/v1/capabilities/consume", body));
    expect(res.status).toBe(http);
    expect((await res.json()).error.code).toBe(code);
  });

  it("refuses a malformed capability before touching the gateway", async () => {
    const { POST } = await import("@/app/api/v1/capabilities/consume/route");
    const res = await POST(req("/api/v1/capabilities/consume", { ...body, capability: "authcap_v1_short" }));
    expect(res.status).toBe(400);
    expect(consumeCapability).not.toHaveBeenCalled();
  });

  it("requires the agent's runtime key as well as the capability", async () => {
    const { POST } = await import("@/app/api/v1/capabilities/consume/route");
    expect((await POST(req("/api/v1/capabilities/consume", body, {}))).status).toBe(401);
  });
});

describe("POST /api/v1/capabilities/revoke", () => {
  const body = { capabilityId: "00000000-0000-4000-8000-000000000009", reason: "done" };
  it.each([
    ["revoked", 200],
    ["already_revoked", 200],
    ["not_revocable", 409],
    ["not_found", 404],
  ])("%s -> %s", async (result, http) => {
    revokeCapabilityViaGateway.mockResolvedValue({ status: "ok", result });
    const { POST } = await import("@/app/api/v1/capabilities/revoke/route");
    expect((await POST(req("/api/v1/capabilities/revoke", body))).status).toBe(http);
  });
});

describe("health and readiness", () => {
  beforeEach(() => {
    schemaVersion.mockResolvedValue(EXPECTED_SCHEMA_VERSION);
  });

  it("liveness touches no dependency and reports no commit when Render's variable is unset", async () => {
    delete process.env.RENDER_GIT_COMMIT;
    const { GET } = await import("@/app/api/v1/health/route");
    expect(await (await GET()).json()).toEqual({ status: "ok" });
    expect(gatewayPing).not.toHaveBeenCalled();
  });

  it("reports a truncated, non-secret build commit when deployed on Render", async () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "abcdef0123456789fullshahere");
    const { GET } = await import("@/app/api/v1/health/route");
    expect(await (await GET()).json()).toEqual({ status: "ok", commit: "abcdef012345" });
  });

  it("readiness is 503 when the gateway is unreachable and 200 when it is not", async () => {
    const { GET } = await import("@/app/api/v1/ready/route");
    process.env.GATEWAY_DATABASE_URL = "postgresql://u:p@h:6543/postgres";
    gatewayPing.mockResolvedValue(true);
    expect((await GET()).status).toBe(200);
    gatewayPing.mockRejectedValue(new Error("down"));
    const down = await GET();
    expect(down.status).toBe(503);
    expect(await down.text()).not.toMatch(/postgresql|down|@h/);
    delete process.env.GATEWAY_DATABASE_URL;
    expect((await GET()).status).toBe(503);
  });

  it("readiness is 503 when the database schema is not the version this build expects", async () => {
    const { GET } = await import("@/app/api/v1/ready/route");
    process.env.GATEWAY_DATABASE_URL = "postgresql://u:p@h:6543/postgres";
    gatewayPing.mockResolvedValue(true);
    schemaVersion.mockResolvedValue("20260101000000");
    const stale = await GET();
    expect(stale.status).toBe(503);
    expect(await stale.json()).toEqual({ status: "not_ready", gateway: "ok", schema: "mismatch" });
    schemaVersion.mockRejectedValue(new Error("no such function"));
    expect((await GET()).status).toBe(503);
    schemaVersion.mockResolvedValue(EXPECTED_SCHEMA_VERSION);
    expect(await (await GET()).json()).toMatchObject({ status: "ready", schema: "current" });
    delete process.env.GATEWAY_DATABASE_URL;
  });

  it("production readiness FAILS while the database certificate chain is not verified", async () => {
    const { GET } = await import("@/app/api/v1/ready/route");
    vi.stubEnv("GATEWAY_DATABASE_URL", "postgresql://u:p@h:6543/postgres");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GATEWAY_DATABASE_CA", "");
    vi.stubEnv("AUTHORITY_DEPLOYMENT", "");
    gatewayPing.mockResolvedValue(true);
    const bad = await GET();
    expect(bad.status).toBe(503);
    expect(await bad.json()).toEqual({ status: "not_ready", gateway: "tls_unverified" });
    vi.stubEnv("GATEWAY_DATABASE_CA", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----");
    const ok = await GET();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "ready", tls: "verified" });
    // Only an explicit local-deployment marker (never set in production) relaxes it, and says so.
    vi.stubEnv("GATEWAY_DATABASE_CA", "");
    vi.stubEnv("AUTHORITY_DEPLOYMENT", "local");
    expect(await (await GET()).json()).toMatchObject({ status: "ready", tls: "unverified_local" });
    vi.unstubAllEnvs();
  });
});
