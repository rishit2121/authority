import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";
import { closeGatewayPool } from "@/lib/gateway/db";
import { consumeCapability } from "@/lib/gateway/rpc";

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
      arguments: { issue_number: "1" },
      idempotencyKey: key,
      maxUses,
      registryVersion: "rv1",
      compilerVersion: "cv1",
    });

  const consume = (f: GatewayFixture, token: string, key: string) =>
    consumeCapability({
      credentialSecret: f.secret,
      tokenHash: hashCapabilityToken(token),
      tool: "github.get_issue",
      operation: "get_issue",
      resource: null,
      args: { issue_number: "1" },
      idempotencyKey: key,
    });

  beforeAll(async () => {
    await resetSemanticSettings();
    fx = await createGatewayFixture({ label: "gw-conc", maxToolInvocations: 50 });
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

  it("lets exactly one of many concurrent consumers use the last use of a single-use capability", async () => {
    const issued = await authorize(fx, "single-use");
    if (issued.kind !== "decision" || !issued.capabilityToken) throw new Error("no capability issued");
    const token = issued.capabilityToken;

    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => consume(fx, token, `race-${i}`)));
    const accepted = results.filter((r) => r.result === "accepted");
    const rejected = results.filter((r) => r.result === "rejected");

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(new Set(rejected.map((r) => r.reasonCode))).toEqual(new Set(["CAPABILITY_ALREADY_USED"]));

    const [row] = (await managementQuery(
      `select uses, status from public.capability_tokens where token_hash = '${hashCapabilityToken(token)}';`,
    )) as Array<{ uses: number; status: string }>;
    expect(row).toMatchObject({ uses: 1, status: "consumed" });
  });

  it("never lets a bounded multi-use capability exceed its uses under concurrency", async () => {
    const issued = await authorize(fx, "multi-use", 3);
    if (issued.kind !== "decision" || !issued.capabilityToken) throw new Error("no capability issued");
    const token = issued.capabilityToken;

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => consume(fx, token, `multi-${i}`)));
    expect(results.filter((r) => r.result === "accepted")).toHaveLength(3);
    const [row] = (await managementQuery(
      `select uses from public.capability_tokens where token_hash = '${hashCapabilityToken(token)}';`,
    )) as Array<{ uses: number }>;
    expect(row.uses).toBe(3);
  });

  it("treats concurrent retries with the same idempotency key as one consumption", async () => {
    const issued = await authorize(fx, "idem-consume");
    if (issued.kind !== "decision" || !issued.capabilityToken) throw new Error("no capability issued");
    const token = issued.capabilityToken;

    const results = await Promise.all(Array.from({ length: 6 }, () => consume(fx, token, "same-key")));
    expect(results.every((r) => r.result === "accepted")).toBe(true);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const [row] = (await managementQuery(
      `select uses from public.capability_tokens where token_hash = '${hashCapabilityToken(token)}';`,
    )) as Array<{ uses: number }>;
    expect(row.uses).toBe(1);
  });

  it("treats concurrent retries of one authorization as a single decision and a single capability", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => authorize(fx, "same-auth-key")));
    const decisions = results.map((r) => (r.kind === "decision" ? r.commit : null));
    expect(new Set(decisions.map((d) => d?.decisionId)).size).toBe(1);
    expect(decisions.filter((d) => d && !d.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.kind === "decision" && r.capabilityToken)).toHaveLength(1);
  });
});
