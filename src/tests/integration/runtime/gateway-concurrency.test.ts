import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";
import { closeGatewayPool } from "@/lib/gateway/db";
import { finishExecution, markDispatched, reserveExecution } from "@/lib/gateway/rpc-github";

import { createGatewayFixture, resetSemanticSettings, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";

/**
 * What pgTAP structurally cannot verify: genuinely concurrent callers, from
 * separate pooled connections, racing for the last unit of budget and the last
 * use of a capability. The atomicity comes from the per-task and per-capability
 * advisory locks inside the gateway functions.
 */
describe("gateway concurrency", () => {
  let fx: GatewayFixture;
  let budgetFx: GatewayFixture;

  const authorize = (f: GatewayFixture, key: string, maxUses = 1) =>
    authorizeThroughGateway({
      credentialSecret: f.secret,
      taskId: f.taskId,
      tool: "github.get_issue",
      operation: "get_issue",
      resource: "acme/widgets",
      arguments: { issue_number: "1" },
      idempotencyKey: key,
      maxUses,
      registryVersion: "rv1",
      compilerVersion: "cv1",
    });

  const reserve = (f: GatewayFixture, token: string, key: string) =>
    reserveExecution({
      credentialSecret: f.secret,
      tokenHash: hashCapabilityToken(token),
      tool: "github.get_issue",
      operation: "get_issue",
      resource: "acme/widgets",
      args: { issue_number: "1" },
      idempotencyKey: key,
      executionMode: "mock",
      leaseSeconds: 45,
    });

  /** Reserve -> dispatch -> succeed, the full happy path for one reservation. */
  const settleSuccess = async (f: GatewayFixture, executionId: string) => {
    await markDispatched({ executionId, agentId: f.agentId });
    return finishExecution({
      executionId, agentId: f.agentId, category: "succeeded", reasonCode: null, githubRequestId: "MOCK-1",
      httpStatusClass: 2, resourceIds: {}, beforeSha: null, afterSha: null, startedAt: new Date(), redaction: {},
    });
  };

  beforeAll(async () => {
    await resetSemanticSettings();
    fx = await createGatewayFixture({ label: "gw-conc", maxToolInvocations: 50, githubRepo: "acme/widgets" });
    budgetFx = await createGatewayFixture({ label: "gw-budget", maxToolInvocations: 1 });
  }, 30_000);

  afterAll(async () => {
    await fx.cleanup();
    await budgetFx.cleanup();
    await closeGatewayPool();
  }, 30_000);

  it("lets exactly one of two concurrent authorizations take the last unit of budget", async () => {
    const [a, b] = await Promise.all([authorize(budgetFx, "conc-a"), authorize(budgetFx, "conc-b")]);
    if (a.kind !== "decision" || b.kind !== "decision") throw new Error("expected decisions");

    const finals = [a.commit.finalOutcome, b.commit.finalOutcome].sort();
    expect(finals).toEqual(["allow_constrained", "deny"]);

    const issued = [a, b].filter((r) => r.kind === "decision" && r.capabilityToken);
    expect(issued).toHaveLength(1);

    const denied = a.commit.finalOutcome === "deny" ? a : b;
    expect(denied.commit.reasonCodes).toContain("INVOCATION_LIMIT_REACHED");
    expect(denied.capabilityToken).toBeNull();

    const rows = (await managementQuery(
      `select consumed_uses, max_invocations from public.capabilities where task_id = '${budgetFx.taskId}';`,
    )) as Array<{ consumed_uses: number; max_invocations: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].consumed_uses).toBe(1);
  });

  it("lets exactly one of many concurrent reservations take the last use of a single-use capability", async () => {
    const issued = await authorize(fx, "single-use");
    if (issued.kind !== "decision" || !issued.capabilityToken) throw new Error("no capability issued");
    const token = issued.capabilityToken;

    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => reserve(fx, token, `race-${i}`)));
    const reserved = results.filter((r) => r.result === "reserved");
    const rejected = results.filter((r) => r.result === "rejected");
    expect(reserved).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(new Set(rejected.map((r) => r.reasonCode))).toEqual(new Set(["RESERVATION_IN_PROGRESS"]));

    const settled = await settleSuccess(fx, reserved[0].executionId!);
    expect(settled.status).toBe("ok");

    // Replay after consumption: a fresh key can no longer reserve anything.
    const after = await reserve(fx, token, "after-consume");
    expect(after).toMatchObject({ result: "rejected", reasonCode: "CAPABILITY_ALREADY_USED" });

    const [row] = (await managementQuery(
      `select uses, reserved_uses, status from public.capability_tokens where token_hash = '${hashCapabilityToken(token)}';`,
    )) as Array<{ uses: number; reserved_uses: number; status: string }>;
    expect(row).toMatchObject({ uses: 1, reserved_uses: 0, status: "consumed" });
  });

  it("never lets a bounded multi-use capability exceed its uses under concurrency", async () => {
    const issued = await authorize(fx, "multi-use", 3);
    if (issued.kind !== "decision" || !issued.capabilityToken) throw new Error("no capability issued");
    const token = issued.capabilityToken;

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => reserve(fx, token, `multi-${i}`)));
    const reserved = results.filter((r) => r.result === "reserved");
    expect(reserved).toHaveLength(3);
    const [held] = (await managementQuery(
      `select uses, reserved_uses from public.capability_tokens where token_hash = '${hashCapabilityToken(token)}';`,
    )) as Array<{ uses: number; reserved_uses: number }>;
    expect(held).toMatchObject({ uses: 0, reserved_uses: 3 });

    for (const r of reserved) await settleSuccess(fx, r.executionId!);
    const [row] = (await managementQuery(
      `select uses, reserved_uses from public.capability_tokens where token_hash = '${hashCapabilityToken(token)}';`,
    )) as Array<{ uses: number; reserved_uses: number }>;
    expect(row).toMatchObject({ uses: 3, reserved_uses: 0 });
  });

  it("treats concurrent retries with the same idempotency key as one reservation", async () => {
    const issued = await authorize(fx, "idem-consume");
    if (issued.kind !== "decision" || !issued.capabilityToken) throw new Error("no capability issued");
    const token = issued.capabilityToken;

    const results = await Promise.all(Array.from({ length: 6 }, () => reserve(fx, token, "same-key")));
    expect(results.filter((r) => r.result === "reserved")).toHaveLength(1);
    expect(results.filter((r) => r.result === "in_progress")).toHaveLength(5);
    expect(new Set(results.map((r) => r.executionId)).size).toBe(1);
    const [row] = (await managementQuery(
      `select uses, reserved_uses from public.capability_tokens where token_hash = '${hashCapabilityToken(token)}';`,
    )) as Array<{ uses: number; reserved_uses: number }>;
    expect(row).toMatchObject({ uses: 0, reserved_uses: 1 });
  });

  it("treats concurrent retries of one authorization as a single decision and a single capability", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => authorize(fx, "same-auth-key")));
    const decisions = results.map((r) => (r.kind === "decision" ? r.commit : null));
    expect(new Set(decisions.map((d) => d?.decisionId)).size).toBe(1);
    expect(decisions.filter((d) => d && !d.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.kind === "decision" && r.capabilityToken)).toHaveLength(1);
  });
});
