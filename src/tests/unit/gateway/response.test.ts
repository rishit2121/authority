import { describe, expect, it } from "vitest";

import type { CommitResult } from "@/lib/gateway/rpc";
import { agentReasonCodes, agentSummary, failureContract, toAgentResponse } from "@/lib/gateway/response";

const base: CommitResult = {
  status: "ok",
  replayed: false,
  decisionId: "d1",
  finalDecisionId: "f1",
  toolRequestId: "t1",
  detOutcome: "allow",
  finalOutcome: "allow",
  reasonCodes: ["WITHIN_CONTRACT"],
  contractId: "c1",
  contractVersion: 2,
  semanticMode: "off",
  semanticPolicy: "not_applicable",
  degraded: false,
  degradedReason: null,
  narrowed: false,
  capabilityId: "cap1",
  capabilityExpiresAt: "2026-01-01T00:01:00.000Z",
  capabilityMaxUses: 1,
  remainingInvocations: 9,
};

describe("toAgentResponse", () => {
  it("includes the capability token exactly when one is supplied", () => {
    const issued = toAgentResponse({
      commit: base,
      capabilityToken: "authcap_v1_x",
      tool: "github.get_issue",
      operation: "get_issue",
    });
    expect(issued.capability?.token).toBe("authcap_v1_x");
    expect(issued.capability?.tokenAlreadyIssued).toBe(false);
    const replay = toAgentResponse({
      commit: { ...base, replayed: true },
      capabilityToken: null,
      tool: "github.get_issue",
      operation: "get_issue",
    });
    expect(replay.capability?.token).toBeNull();
    expect(replay.capability?.tokenAlreadyIssued).toBe(true);
  });

  it("labels an unrecognized tool a simulation", () => {
    expect(
      toAgentResponse({ commit: base, capabilityToken: null, tool: "a.b", operation: "b" }).simulation,
    ).toBe(true);
  });

  it("labels GitHub's six connector tools, and every other registered connector's tools, as real -- not simulated", () => {
    // Regression: CONNECTOR_TOOLS used to be a hand-maintained, GitHub-only
    // list, so a real connector's own real execution (Stripe, Slack, Gmail,
    // Postgres, Custom API) was mislabeled `simulation: true` in the agent-
    // facing authorize response even though /api/v1/execute genuinely
    // dispatched it to a live provider.
    for (const tool of [
      "github.get_issue",
      "stripe.issue_refund",
      "slack.post_message",
      "gmail.list_labels",
    ]) {
      expect(toAgentResponse({ commit: base, capabilityToken: null, tool, operation: "x" }).simulation).toBe(
        false,
      );
    }
  });

  it("gives an agent no signals, indicators, provider, confidence or raw semantic codes", () => {
    const narrowed = toAgentResponse({
      commit: {
        ...base,
        finalOutcome: "deny",
        narrowed: true,
        semanticMode: "enforce",
        reasonCodes: ["SEMANTIC_CRITICAL_RISK", "WITHIN_CONTRACT"],
        capabilityId: null,
      },
      capabilityToken: null,
      tool: "a.b",
      operation: "b",
    });
    const json = JSON.stringify(narrowed);
    for (const leaked of [
      "SEMANTIC_",
      "signals",
      "indicators",
      "confidence",
      "promptInjection",
      "provider",
      "riskLevel",
    ]) {
      expect(json).not.toContain(leaked);
    }
    expect(narrowed.reasonCodes[0]).toBe("SECURITY_POLICY_DENIED");
    expect(narrowed.enforcement).toEqual({
      mode: "enforce",
      degraded: false,
      narrowedBySecurityPolicy: true,
    });
  });

  it("hides the optional-degraded marker but reports degradation as a flag", () => {
    const r = toAgentResponse({
      commit: {
        ...base,
        semanticMode: "enforce",
        degraded: true,
        degradedReason: "timeout",
        reasonCodes: ["SEMANTIC_DEGRADED_OPTIONAL", "WITHIN_CONTRACT"],
      },
      capabilityToken: "authcap_v1_y",
      tool: "a.b",
      operation: "b",
    });
    expect(r.reasonCodes).toEqual(["WITHIN_CONTRACT"]);
    expect(r.enforcement.degraded).toBe(true);
    expect(JSON.stringify(r)).not.toContain("timeout");
  });

  it("maps every outcome to the right requires* flag", () => {
    const f = (o: CommitResult["finalOutcome"]) =>
      toAgentResponse({
        commit: { ...base, finalOutcome: o, capabilityId: null },
        capabilityToken: null,
        tool: "a.b",
        operation: "b",
      });
    expect(f("require_approval").requiresApproval).toBe(true);
    expect(f("clarify").requiresClarification).toBe(true);
    expect(f("replan").requiresReplan).toBe(true);
    expect(f("allow").requiresApproval).toBe(false);
  });

  it("returns no policy text: summaries are generic", () => {
    expect(agentSummary(agentReasonCodes(["FORBIDDEN_RESOURCE"]))).not.toMatch(/secret|pattern|glob/i);
  });
});

describe("failureContract", () => {
  it("gives an unknown key and a revoked key the identical answer", () => {
    expect(failureContract("invalid_credential")).toEqual(failureContract("revoked_credential"));
  });
  it.each([
    ["rate_limited", 429],
    ["task_not_found", 404],
    ["agent_mismatch", 403],
    ["idempotency_conflict", 409],
    ["invalid_credential", 401],
  ] as const)("%s -> %s", (status, http) => expect(failureContract(status).http).toBe(http));
  it("tells a rate-limited caller when to retry", () =>
    expect(failureContract("rate_limited").retryAfterSeconds).toBe(60));
});
