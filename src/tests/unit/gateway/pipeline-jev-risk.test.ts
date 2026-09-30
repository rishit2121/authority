import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CircuitBreaker } from "@/lib/semantic/circuit-breaker";
import { MockSemanticRiskProvider } from "@/lib/semantic/mock-provider";
import { authorizeThroughGateway, type AuthorizeInput, type PipelineDeps } from "@/lib/gateway/pipeline";
import type { CommitResult, PrepareResult } from "@/lib/gateway/rpc";

const { jevRiskModeForTask, recordRiskEvaluation } = vi.hoisted(() => ({
  jevRiskModeForTask: vi.fn(),
  recordRiskEvaluation: vi.fn(),
}));
vi.mock("@/lib/jev/risk-persistence", () => ({ jevRiskModeForTask, recordRiskEvaluation }));

const prepared = (over: Partial<PrepareResult> = {}): PrepareResult => ({
  status: "ok",
  mode: "off",
  provider: null,
  model: null,
  timeoutMs: null,
  required: false,
  enforceable: false,
  capabilityTtlSeconds: 60,
  taskIntent: "Read issue 1",
  allowedTools: ["github.get_issue"],
  priorCalls: [],
  detOutcome: "allow",
  alreadyDecided: false,
  ...over,
});

const committed = (over: Partial<CommitResult> = {}): CommitResult => ({
  status: "ok",
  replayed: false,
  decisionId: "d",
  finalDecisionId: "f",
  toolRequestId: "t",
  detOutcome: "allow",
  finalOutcome: "allow",
  reasonCodes: ["WITHIN_CONTRACT"],
  contractId: "c",
  contractVersion: 1,
  semanticMode: "off",
  semanticPolicy: "optional",
  degraded: false,
  degradedReason: null,
  narrowed: false,
  capabilityId: "cap",
  capabilityExpiresAt: "2026-01-01T00:01:00.000Z",
  capabilityMaxUses: 1,
  remainingInvocations: 5,
  ...over,
});

const input: AuthorizeInput = {
  credentialSecret: "authority_rk_secretsecretsecret",
  taskId: "00000000-0000-4000-8000-000000000001",
  tool: "github.get_issue",
  operation: "get_issue",
  arguments: { issue_number: "1" },
  idempotencyKey: "k",
  registryVersion: "rv1",
  compilerVersion: "cv1",
};

function deps(over: { p?: Partial<PrepareResult>; c?: Partial<CommitResult> } = {}): PipelineDeps {
  return {
    prepare: vi.fn().mockResolvedValue(prepared(over.p)) as never,
    commit: vi.fn().mockResolvedValue(committed(over.c)) as never,
    approval: vi.fn().mockResolvedValue({ status: "ok", approvalId: null }) as never,
    createProvider: vi.fn(() => new MockSemanticRiskProvider()) as never,
    breakerFor: () => new CircuitBreaker(),
  };
}

/** The pipeline fires shadow risk evaluation without awaiting it — flush the microtask queue before asserting. */
async function flush(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
  jevRiskModeForTask.mockReset().mockResolvedValue({ tenantId: null, mode: "off" });
  recordRiskEvaluation.mockReset().mockResolvedValue(undefined);
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authorizeThroughGateway: shadow-mode Jev risk evaluation", () => {
  it("never checks or runs risk evaluation for a failed authorization", async () => {
    await authorizeThroughGateway(input, deps({ p: { status: "invalid_credential" } }));
    await flush();
    expect(jevRiskModeForTask).not.toHaveBeenCalled();
  });

  it("checks the mode but records nothing when risk mode is off (the default)", async () => {
    const result = await authorizeThroughGateway(input, deps());
    await flush();
    expect(result.kind).toBe("decision");
    expect(jevRiskModeForTask).toHaveBeenCalledWith(input.taskId);
    expect(recordRiskEvaluation).not.toHaveBeenCalled();
  });

  it("never checks or records anything for a replayed decision", async () => {
    jevRiskModeForTask.mockResolvedValue({ tenantId: "t1", mode: "shadow" });
    await authorizeThroughGateway(input, deps({ c: { replayed: true } }));
    await flush();
    expect(jevRiskModeForTask).not.toHaveBeenCalled();
  });

  it("does not check risk mode when OPENROUTER_JEV_DECISION_MODEL is unset, even if the tenant asked for shadow", async () => {
    jevRiskModeForTask.mockResolvedValue({ tenantId: "t1", mode: "shadow" });
    await authorizeThroughGateway(input, deps());
    await flush();
    expect(recordRiskEvaluation).not.toHaveBeenCalled();
  });

  it("records a shadow risk evaluation when configured and enabled, without ever changing the returned decision", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("OPENROUTER_JEV_DECISION_MODEL", "typesafe/jev-1.13");
    jevRiskModeForTask.mockResolvedValue({ tenantId: "t1", mode: "shadow" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ answers: { riskClass: { type: "choice", choice: "low", confidence: 0.8 } } }),
        } as Response),
      ),
    );
    const result = await authorizeThroughGateway(input, deps());
    expect(result.kind).toBe("decision");
    if (result.kind === "decision") expect(result.commit.finalOutcome).toBe("allow"); // the shadow evaluation never touches this
    await flush(20);
    expect(recordRiskEvaluation).toHaveBeenCalledTimes(1);
    const call = recordRiskEvaluation.mock.calls[0][0];
    expect(call).toMatchObject({
      tenantId: "t1",
      taskId: input.taskId,
      toolRequestId: "t",
      // The deterministic decision's own id (authorization_decisions.id), which jev_risk_evaluations'
      // foreign key actually targets — NOT commit.finalDecisionId (final_decisions.id, a different id space).
      authorizationDecisionId: "d",
      deterministicDecision: "allow",
      finalDecision: "allow",
    });
    expect(call.run.evaluation.riskClass).toBe("low");
  });

  it("never lets a throwing risk provider affect the returned decision, and never propagates the error", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("OPENROUTER_JEV_DECISION_MODEL", "typesafe/jev-1.13");
    jevRiskModeForTask.mockResolvedValue({ tenantId: "t1", mode: "shadow" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    const result = await authorizeThroughGateway(input, deps());
    expect(result.kind).toBe("decision");
    await flush(20);
    // The run either never got far enough to record, or recorded a degraded state — either way nothing threw.
    if (recordRiskEvaluation.mock.calls.length > 0) {
      expect(recordRiskEvaluation.mock.calls[0][0].run.state).not.toBe("ok");
    }
  });
});
