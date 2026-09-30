import { describe, expect, it } from "vitest";

import { buildRuntimeRows, decisionTrace, effectiveCapabilityState } from "@/lib/runtime/dashboard-model";

const NOW = new Date("2026-01-01T00:00:30.000Z");
const decision = (over = {}) => ({
  id: "d1",
  outcome: "allow",
  reason_codes: { items: [{ code: "WITHIN_CONTRACT" }] },
  contract_id: "c",
  contract_version: 1,
  tool_request_id: "r1",
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});
const request = {
  id: "r1",
  tool: "github.get_issue",
  operation: "get_issue",
  resource: null,
  task_id: "t",
  agent_id: "a",
  arguments_redacted: true,
};
const final = (over = {}) => ({
  id: "f1",
  authorization_decision_id: "d1",
  deterministic_outcome: "allow",
  final_outcome: "allow",
  semantic_mode: "off",
  semantic_policy: "not_applicable",
  risk_class: "low",
  composition_reasons: [],
  degraded: false,
  degraded_reason: null,
  narrowed: false,
  ...over,
});
const token = (over = {}) => ({
  id: "cap",
  final_decision_id: "f1",
  issued_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2026-01-01T00:01:00.000Z",
  max_uses: 1,
  uses: 0,
  status: "active",
  revoked_by: null,
  revocation_reason: null,
  ...over,
});
const build = (over: Partial<Parameters<typeof buildRuntimeRows>[0]> = {}) =>
  buildRuntimeRows({
    decisions: [decision()],
    requests: [request],
    finals: [final()],
    tokens: [token()],
    consumptions: [],
    evidenceByDecision: new Map(),
    agentNames: new Map([["a", "agent"]]),
    now: NOW,
    ...over,
  });

describe("effectiveCapabilityState", () => {
  it("derives expired from time even when the stored status is still active", () => {
    expect(effectiveCapabilityState({ status: "active", expires_at: "2026-01-01T00:00:10.000Z" }, NOW)).toBe(
      "expired",
    );
    expect(effectiveCapabilityState({ status: "active", expires_at: "2026-01-01T00:01:00.000Z" }, NOW)).toBe(
      "active",
    );
  });
  it("prefers revoked and consumed over expiry", () => {
    expect(effectiveCapabilityState({ status: "revoked", expires_at: "2026-01-01T00:00:10.000Z" }, NOW)).toBe(
      "revoked",
    );
    expect(
      effectiveCapabilityState({ status: "consumed", expires_at: "2026-01-01T00:00:10.000Z" }, NOW),
    ).toBe("consumed");
  });
});

describe("buildRuntimeRows", () => {
  it("reports TTL and remaining uses", () => {
    const [row] = build();
    expect(row.capability).toMatchObject({
      state: "active",
      ttlRemainingSeconds: 30,
      remainingUses: 1,
      maxUses: 1,
    });
  });

  it("counts accepted consumptions and replay attempts separately", () => {
    const [row] = build({
      tokens: [token({ uses: 1, status: "consumed" })],
      consumptions: [
        { capability_id: "cap", result: "accepted", reason_code: "ACCEPTED" },
        { capability_id: "cap", result: "rejected", reason_code: "CAPABILITY_ALREADY_USED" },
        { capability_id: "cap", result: "rejected", reason_code: "SCOPE_MISMATCH" },
      ],
    });
    expect(row.capability).toMatchObject({
      state: "consumed",
      acceptedConsumptions: 1,
      replayAttempts: 1,
      rejectedAttempts: 2,
    });
  });

  it("shows a pre-Part-6 decision as its own deterministic outcome, marked pre-gateway", () => {
    const [row] = build({ finals: [], tokens: [] });
    expect(row.gateway).toBe(false);
    expect(row.final).toBe("allow");
    expect(row.capability).toBeNull();
    expect(decisionTrace(row)[0].detail).toMatch(/before the Part 6 gateway/);
  });

  it("keeps deterministic and final results separate when semantic narrowed the decision", () => {
    const [row] = build({
      finals: [
        final({
          final_outcome: "deny",
          narrowed: true,
          semantic_mode: "enforce",
          composition_reasons: ["SEMANTIC_CRITICAL_RISK"],
        }),
      ],
      tokens: [],
    });
    expect(row.deterministic).toBe("allow");
    expect(row.final).toBe("deny");
    expect(row.narrowed).toBe(true);
    expect(decisionTrace(row).find((s) => s.step === "Composition")?.detail).toMatch(/narrowed/);
  });

  it("surfaces a fail-closed degraded state", () => {
    const [row] = build({
      finals: [
        final({
          final_outcome: "deny",
          degraded: true,
          degraded_reason: "timeout",
          semantic_mode: "enforce",
          semantic_policy: "required",
        }),
      ],
      tokens: [],
    });
    expect(row.degraded).toBe(true);
    expect(row.degradedReason).toBe("timeout");
  });

  it("derives disagreement from the two decisions", () => {
    const evidence = new Map([
      [
        "d1",
        {
          id: "e",
          decisionId: "d1",
          taskId: "t",
          provider: "mock",
          model: "m",
          modelVersion: "1",
          state: "ok",
          riskLevel: "critical",
          signals: null,
          indicators: [],
          confidence: 1,
          latencyMs: 1,
          disagreement: "none",
          errorCategory: null,
          redactionCounts: {},
          createdAt: "x",
        },
      ],
    ]);
    const [row] = build({ evidenceByDecision: evidence });
    expect(row.evidence?.disagreement).toBe("semantic_flags_permitted");
  });

  it("skips a decision whose request row is not visible", () => {
    expect(build({ requests: [] })).toHaveLength(0);
  });

  it("leaves jevRisk undefined when no risk evaluation was recorded for the decision", () => {
    const [row] = build();
    expect(row.jevRisk).toBeUndefined();
    expect(decisionTrace(row).some((s) => s.step === "Jev risk (shadow)")).toBe(false);
  });

  it("maps a recorded Jev risk evaluation onto the row, always as advisory-only", () => {
    const jevRiskByDecision = new Map([
      [
        "d1",
        {
          authorization_decision_id: "d1",
          provider: "openrouter",
          model: "typesafe/jev-1.13",
          state: "ok",
          result: { riskClass: "high", confidence: 0.82, categories: ["task_divergence"], evidenceCodes: [] },
          disagreement: true,
          latency_ms: 420,
          error_category: null,
        },
      ],
    ]);
    const [row] = build({ jevRiskByDecision });
    expect(row.jevRisk).toMatchObject({
      provider: "openrouter",
      state: "ok",
      riskClass: "high",
      confidence: 0.82,
      disagreement: true,
      latencyMs: 420,
    });
    const step = decisionTrace(row).find((s) => s.step === "Jev risk (shadow)");
    expect(step?.detail).toMatch(/high-risk/);
    expect(step?.detail).toMatch(/never affected this decision/);
  });

  it("surfaces a non-ok Jev risk state without an evaluation", () => {
    const jevRiskByDecision = new Map([
      [
        "d1",
        {
          authorization_decision_id: "d1",
          provider: "openrouter",
          model: "typesafe/jev-1.13",
          state: "timeout",
          result: null,
          disagreement: false,
          latency_ms: 15000,
          error_category: "timeout",
        },
      ],
    ]);
    const [row] = build({ jevRiskByDecision });
    expect(row.jevRisk).toMatchObject({ state: "timeout", riskClass: null, confidence: null });
  });
});
