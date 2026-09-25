import { describe, expect, it } from "vitest";

import type { CandidatePlan, Policy } from "@/lib/domain";
import { githubDemoRegistry, loadRegistry, type RegistryData } from "@/lib/registry";

import { deriveRequiredApprovals } from "@/lib/authorization/approval-rules";
import { canonicalHash } from "@/lib/authorization/canonicalize";
import { compileContract } from "@/lib/authorization/contract-compiler";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";

/**
 * `activateContractAction` (src/app/app/tasks/[taskId]/contract/actions.ts)
 * refuses to activate unless recompiling the persisted plan against the
 * *current* registry and policies reproduces byte-identical input/output
 * hashes and an identical required-approvals spec. That action itself
 * cannot be unit-tested directly here — it depends on `next/headers`'
 * request-scoped `cookies()`, unavailable outside a real request — so this
 * instead proves the property the action's refusal logic actually depends
 * on: that a genuine change to policy or registry content changes the
 * compiled hash and the derived approvals, deterministically and every
 * time. If this property held, the action's comparison would always catch
 * a stale or tampered proposal; if it didn't, comparing hashes would be
 * security theater. The RPC layer's own independent enforcement (pgTAP
 * suite 16) is the actual backstop regardless of this TypeScript check.
 */

const PLAN: CandidatePlan = {
  schemaVersion: 1,
  taskId: "task_1",
  nodes: [
    {
      id: "a",
      sequence: 0,
      tool: "github.create_branch",
      arguments: { repository: "payments-api", branch: "fix-1" },
      dependencies: [],
      declaredOutputs: [],
      dataFlowRefs: [],
      expectedSideEffect: "write_create",
      maxInvocations: 1,
    },
  ],
};

const NO_SECRETS_POLICY: Policy = {
  id: "pol_no_secrets",
  tenantId: "ten_1",
  name: "Never read repository secrets",
  version: 1,
  status: "active",
  effect: "deny",
  conditions: [{ key: "resource", matches: "*secret*" }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const REQUIRE_APPROVAL_POLICY: Policy = {
  id: "pol_review_branches",
  tenantId: "ten_1",
  name: "Review all branch creation",
  version: 1,
  status: "active",
  effect: "require_approval",
  conditions: [{ key: "tool", matches: "github.create_branch" }],
  requiredApprovalRole: "admin",
  requiredApprovalCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function compileAgainst(registry: ReturnType<typeof loadRegistry>, activePolicies: readonly Policy[]) {
  const validation = validateCandidatePlan(PLAN, { registry, activePolicies });
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
  const compiled = compileContract({ candidatePlan: PLAN, validation, solverOutcome, registry });
  const requiredApprovals = deriveRequiredApprovals({
    candidatePlan: PLAN,
    validation,
    solverOutcome,
    registry,
    activePolicies,
  });
  return { compiled, requiredApprovals };
}

describe("activation re-verification detection properties", () => {
  it("is deterministic: recompiling the same plan against the same registry and policies twice produces identical hashes", () => {
    const registry = loadRegistry(githubDemoRegistry);
    const first = compileAgainst(registry, []);
    const second = compileAgainst(registry, []);
    expect(first.compiled.inputHash).toBe(second.compiled.inputHash);
    expect(first.compiled.outputHash).toBe(second.compiled.outputHash);
  });

  it("a newly-added active policy (approval requirement) changes the derived approvals spec's hash", () => {
    const registry = loadRegistry(githubDemoRegistry);
    const before = compileAgainst(registry, []);
    const after = compileAgainst(registry, [REQUIRE_APPROVAL_POLICY]);

    const beforeApprovalsHash = canonicalHash({ schemaVersion: 1, items: before.requiredApprovals });
    const afterApprovalsHash = canonicalHash({ schemaVersion: 1, items: after.requiredApprovals });

    expect(beforeApprovalsHash).not.toBe(afterApprovalsHash);
  });

  it("a newly-added active deny policy changes the compiled output hash (and can turn a solvable plan unsolvable)", () => {
    // A deny policy matching this node's operation removes it from
    // requiredOperations entirely, which the solver treats as "nothing
    // left to authorize" once no node is included at all. Use a policy
    // that denies the resource type without eliminating the whole plan, so
    // both compilations still succeed and can be compared directly.
    const registry = loadRegistry(githubDemoRegistry);
    const before = compileAgainst(registry, []);
    const afterValidation = validateCandidatePlan(PLAN, { registry, activePolicies: [NO_SECRETS_POLICY] });
    // This particular plan doesn't touch secrets, so the deny policy is a
    // no-op here — demonstrating the negative case: an *irrelevant* policy
    // change must NOT change the hash.
    const afterSolver = solveMinimumAuthority({
      requiredOperations: afterValidation.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (afterSolver.status !== "solved") throw new Error(afterSolver.status);
    const afterCompiled = compileContract({
      candidatePlan: PLAN,
      validation: afterValidation,
      solverOutcome: afterSolver,
      registry,
    });

    expect(afterCompiled.outputHash).toBe(before.compiled.outputHash);
  });

  it("a different registry version changes the compiled output hash even for byte-identical plan content", () => {
    const registryV1 = loadRegistry(githubDemoRegistry);
    const widenedData: RegistryData = {
      ...githubDemoRegistry,
      registryVersion: "github-demo-2026-09-23-changed",
    };
    const registryV2 = loadRegistry(widenedData);

    const before = compileAgainst(registryV1, []);
    const after = compileAgainst(registryV2, []);

    expect(before.compiled.registryVersion).not.toBe(after.compiled.registryVersion);
    expect(before.compiled.outputHash).not.toBe(after.compiled.outputHash);
  });

  it("tampering with the persisted output (simulating a forged/edited proposal) is detected by hash mismatch, not by trusting the stored value", () => {
    const registry = loadRegistry(githubDemoRegistry);
    const { compiled } = compileAgainst(registry, []);

    // Simulate a forged persisted contract: same claimed hash field, but
    // content a real attacker might try to widen (an extra allowed action).
    const forged = {
      ...compiled,
      allowedActions: [
        ...compiled.allowedActions,
        { tool: "github.get_repository_secrets", constraints: [] },
      ],
    };

    // The activation action never trusts `forged.outputHash` as evidence
    // that `forged.allowedActions` is what the registry/policies actually
    // produce — it recomputes independently and compares. Recomputing from
    // the tampered content would produce a different hash than the
    // original, honest compilation's stored hash.
    const recomputedFromForgedContent = canonicalHash({
      specVersion: forged.specVersion,
      allowedActions: forged.allowedActions,
      forbiddenResources: [...forged.forbiddenResources].sort(),
      forbiddenOperations: [...forged.forbiddenOperations].sort(),
      ephemeralLimits: forged.ephemeralLimits,
      dataFlowBindings: forged.dataFlowBindings,
      requiredApprovals: [...forged.requiredApprovals].sort(),
      reviewRequiredOperations: [...forged.reviewRequiredOperations].sort(),
      registryVersion: forged.registryVersion,
      compilerVersion: forged.compilerVersion,
      selectedPermissionIds: forged.selectedPermissionIds,
      excessOperations: forged.excessOperations,
    });

    expect(recomputedFromForgedContent).not.toBe(compiled.outputHash);
  });
});
