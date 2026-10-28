import { describe, expect, it, vi } from "vitest";

import { compileContract } from "@/lib/authorization/contract-compiler";
import { validateCandidatePlan, type PlanValidationResult } from "@/lib/authorization/plan-validator";
import { compileVerifiedContract, reproduceStoredContract } from "@/lib/authorization/prepare-pipeline";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import type { CandidatePlan } from "@/lib/domain";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

const registry = loadRegistry(githubDemoRegistry);

const plan: CandidatePlan = {
  schemaVersion: 1,
  taskId: "task_pp",
  nodes: [
    {
      id: "post",
      sequence: 1,
      tool: "slack.post_message",
      arguments: { channel: "C-ops", text: "Deployed." },
      dependencies: [],
      declaredOutputs: [],
      dataFlowRefs: [],
      expectedSideEffect: "write_create",
      maxInvocations: 1,
    },
    {
      id: "issue",
      sequence: 2,
      tool: "linear.create_issue",
      arguments: { team_id: "T-1", title: "Bug" },
      dependencies: [],
      declaredOutputs: [],
      dataFlowRefs: [],
      expectedSideEffect: "write_create",
      maxInvocations: 1,
    },
  ],
};

const mechanical = validateCandidatePlan(plan, { registry, activePolicies: [] });

/** What Jev necessity in enforce mode produces when it judges the Linear step unnecessary. */
const withoutIssue: PlanValidationResult = {
  ...mechanical,
  includedNodeIds: mechanical.includedNodeIds.filter((id) => id !== "issue"),
  requiredOperations: mechanical.requiredOperations.filter((op) => op !== "linear.create_issue"),
  findings: mechanical.findings.map((f) =>
    f.nodeId === "issue" ? { ...f, status: "replan" as const, reasons: ["not necessary for the task"] } : f,
  ),
};

const common = { plan, registry, activePolicies: [], tenantId: "tenant", taskId: plan.taskId };

function storedFrom(validation: PlanValidationResult, narrowed: boolean) {
  const core = compileVerifiedContract({ ...common, validation, narrowed });
  if (!core.ok) throw new Error(core.reason);
  return { inputHash: core.compiled.inputHash, outputHash: core.compiled.outputHash };
}

describe("compileVerifiedContract", () => {
  it("compiles exactly what the individual steps compile (one shared core for every path)", () => {
    const core = compileVerifiedContract({ ...common, validation: mechanical, narrowed: false });
    if (!core.ok) throw new Error(core.reason);
    const solverOutcome = solveMinimumAuthority({
      requiredOperations: mechanical.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
    const direct = compileContract({ candidatePlan: plan, validation: mechanical, solverOutcome, registry });
    expect(core.compiled.inputHash).toBe(direct.inputHash);
    expect(core.compiled.outputHash).toBe(direct.outputHash);
    expect(core.verification.ok).toBe(true);
  });
});

describe("reproduceStoredContract (activation re-check)", () => {
  it("accepts a contract equal to the mechanical compilation without re-running Jev, even if Jev would narrow it", async () => {
    // A backend-prepared contract waiting for approval, activated by a person while the tenant has Jev enforce on.
    const narrow = vi.fn(async () => withoutIssue);
    const result = await reproduceStoredContract({
      ...common,
      mechanicalValidation: mechanical,
      stored: storedFrom(mechanical, false),
      narrow,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.narrowed).toBe(false);
    expect(narrow).not.toHaveBeenCalled();
  });

  it("re-runs Jev for a contract compiled from a Jev-narrowed plan, and accepts it when Jev still agrees", async () => {
    const narrow = vi.fn(async () => withoutIssue);
    const result = await reproduceStoredContract({
      ...common,
      mechanicalValidation: mechanical,
      stored: storedFrom(withoutIssue, true),
      narrow,
    });
    expect(narrow).toHaveBeenCalledOnce();
    expect(result.ok && result.narrowed).toBe(true);
  });

  it("refuses a narrowed contract when Jev now classifies the plan differently", async () => {
    const result = await reproduceStoredContract({
      ...common,
      mechanicalValidation: mechanical,
      stored: storedFrom(withoutIssue, true),
      narrow: async () => mechanical,
    });
    expect(result).toEqual({ ok: false, reason: "different" });
  });

  it("refuses a contract that matches neither compilation", async () => {
    const result = await reproduceStoredContract({
      ...common,
      mechanicalValidation: mechanical,
      stored: { inputHash: "0".repeat(64), outputHash: "0".repeat(64) },
      narrow: async () => mechanical,
    });
    expect(result).toEqual({ ok: false, reason: "different" });
  });
});
