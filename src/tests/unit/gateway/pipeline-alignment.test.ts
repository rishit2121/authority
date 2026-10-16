import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gateway/db", () => ({ gatewayQuery: vi.fn() }));

import { authorizeThroughGateway, defaultPipelineDeps, type PipelineDeps } from "@/lib/gateway/pipeline";
import type { CommitResult, PrepareResult } from "@/lib/gateway/rpc";

const prepared: PrepareResult = {
  status: "ok",
  mode: "off",
  provider: null,
  model: null,
  timeoutMs: null,
  required: false,
  enforceable: false,
  capabilityTtlSeconds: 60,
  taskIntent: "x",
  allowedTools: ["gmail.send_email"],
  priorCalls: [],
  detOutcome: "allow_constrained",
  alreadyDecided: false,
};

const committed = (status: CommitResult["status"] = "ok"): CommitResult => ({
  status,
  replayed: false,
  decisionId: "d",
  finalDecisionId: "f",
  toolRequestId: "tr",
  detOutcome: "allow_constrained",
  finalOutcome: "allow_constrained",
  reasonCodes: [],
  contractId: "c",
  contractVersion: 1,
  semanticMode: "off",
  semanticPolicy: "not_applicable",
  degraded: false,
  degradedReason: null,
  narrowed: false,
  capabilityId: "cap",
  capabilityExpiresAt: new Date().toISOString(),
  capabilityMaxUses: 1,
  remainingInvocations: 0,
});

function deps(
  over: Partial<PipelineDeps>,
): PipelineDeps & { commit: ReturnType<typeof vi.fn>; commitAligned: ReturnType<typeof vi.fn> } {
  return {
    ...defaultPipelineDeps,
    prepare: vi.fn(async () => prepared),
    commit: vi.fn(async () => committed()),
    commitAligned: vi.fn(async () => committed()),
    approval: vi.fn(),
    riskClassFor: () => "medium",
    registryRequiresApproval: () => false,
    ...over,
  } as never;
}

const input = {
  credentialSecret: "authority_ts_x",
  taskId: "t",
  tool: "gmail.send_email",
  operation: "send_email",
  arguments: { to: "alice@acme.test" },
  idempotencyKey: "k",
  registryVersion: "rv",
  compilerVersion: "cv",
};

describe("pipeline with task alignment", () => {
  it("a blocked call never reaches commit: no decision, no budget, no capability", async () => {
    const d = deps({
      actionCheck: async () => ({
        kind: "block",
        outcome: "misaligned",
        reviewId: "r1",
        policy: "production",
        findings: [],
        feedback: "f",
      }),
    });
    const r = await authorizeThroughGateway(input, d);
    expect(r).toMatchObject({ kind: "alignment", outcome: "misaligned", reviewId: "r1" });
    expect(d.commit).not.toHaveBeenCalled();
    expect(d.commitAligned).not.toHaveBeenCalled();
  });

  it("a cleared call commits only through the aligned wrapper, bound to its review", async () => {
    const d = deps({ actionCheck: async () => ({ kind: "clear", reviewId: "r2", covered: false }) });
    const r = await authorizeThroughGateway(input, d);
    expect(r.kind).toBe("decision");
    expect(d.commitAligned).toHaveBeenCalledWith(
      "r2",
      expect.objectContaining({ idempotencyKey: "k", args: input.arguments }),
    );
    expect(d.commit).not.toHaveBeenCalled();
  });

  it("a stale review is re-checked once against the new state", async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce({ kind: "clear", reviewId: "old", covered: false })
      .mockResolvedValueOnce({ kind: "clear", reviewId: "new", covered: false });
    const commitAligned = vi
      .fn()
      .mockResolvedValueOnce(committed("alignment_stale"))
      .mockResolvedValueOnce(committed());
    const d = deps({ actionCheck: check, commitAligned });
    expect((await authorizeThroughGateway(input, d)).kind).toBe("decision");
    expect(commitAligned.mock.calls.map((c) => c[0])).toEqual(["old", "new"]);
  });

  it("task isolation failure is a failure, before any review or commit", async () => {
    const d = deps({ actionCheck: async () => ({ kind: "failure", status: "session_required" }) });
    expect(await authorizeThroughGateway(input, d)).toEqual({ kind: "failure", status: "session_required" });
    expect(d.commit).not.toHaveBeenCalled();
  });

  it("shadow reviews run after the normal commit and cannot change it", async () => {
    const order: string[] = [];
    const d = deps({
      commit: vi.fn(async () => {
        order.push("commit");
        return committed();
      }),
      actionCheck: async () => ({
        kind: "shadow",
        after: async () => {
          order.push("review");
          throw new Error("reviewer down");
        },
      }),
    });
    const r = await authorizeThroughGateway(input, d);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.kind).toBe("decision");
    expect(order).toEqual(["commit", "review"]);
  });
});

describe("task-session enforcement is independent of task alignment", () => {
  it("refuses a raw runtime key before prepare when the application requires sessions -- with alignment off", async () => {
    const policy = vi.fn(async () => "session_required" as const);
    const d = deps({ credentialPolicy: policy, actionCheck: undefined, commitAligned: undefined });
    const r = await authorizeThroughGateway({ ...input, credentialSecret: "authority_rk_abc" }, d);
    expect(r).toEqual({ kind: "failure", status: "session_required" });
    expect(d.prepare).not.toHaveBeenCalled();
  });

  it("never consults the policy for a task session (already bound to one task)", async () => {
    const policy = vi.fn(async () => "session_required" as const);
    const d = deps({ credentialPolicy: policy, actionCheck: undefined });
    const r = await authorizeThroughGateway(input, d);
    expect(r.kind).toBe("decision");
    // With no alignment check, the decision says so explicitly.
    expect(r.kind === "decision" && r.taskAlignment).toBe("not_run");
    expect(policy).not.toHaveBeenCalled();
  });
});
