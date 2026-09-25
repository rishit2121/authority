import { describe, expect, it } from "vitest";

import type { CandidatePlan } from "@/lib/domain";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

import { compileContract, type CompiledContract } from "@/lib/authorization/contract-compiler";
import { verifyCompiledContract } from "@/lib/authorization/contract-verifier";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";

const registry = loadRegistry(githubDemoRegistry);

const PLAN: CandidatePlan = {
  schemaVersion: 1,
  taskId: "task_991",
  nodes: [
    {
      id: "create-branch",
      sequence: 0,
      tool: "github.create_branch",
      arguments: { repository: "payments-api", branch: "fix-991" },
      dependencies: [],
      declaredOutputs: [],
      dataFlowRefs: [],
      expectedSideEffect: "write_create",
      maxInvocations: 1,
    },
    {
      id: "push-commit",
      sequence: 1,
      tool: "github.push_commit",
      arguments: { repository: "payments-api", branch: "fix-991" },
      dependencies: ["create-branch"],
      declaredOutputs: [],
      dataFlowRefs: [],
      expectedSideEffect: "write_update",
      maxInvocations: 3,
    },
  ],
};

function compile() {
  const validation = validateCandidatePlan(PLAN, { registry, activePolicies: [] });
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
  return compileContract({ candidatePlan: PLAN, validation, solverOutcome, registry });
}

function baseVerifyInput(compiled: CompiledContract) {
  return {
    candidatePlan: PLAN,
    registry,
    activePolicies: [],
    compiled,
    tenantId: "ten_1",
    taskId: "task_991",
    maxAllowedExpirySeconds: 3600,
    supportedRegistryVersions: [registry.registryVersion],
    supportedCompilerVersions: [compiled.compilerVersion],
  };
}

describe("verifyCompiledContract", () => {
  it("passes for a genuinely, honestly compiled contract", () => {
    const compiled = compile();
    const result = verifyCompiledContract(baseVerifyInput(compiled));
    expect(result.ok).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when the contract adds an operation absent from the accepted plan (tampered content)", () => {
    const compiled = compile();
    const tampered: CompiledContract = {
      ...compiled,
      allowedActions: [
        ...compiled.allowedActions,
        { tool: "github.create_pull_request", constraints: [], maxInvocations: 1 },
      ],
    };
    const result = verifyCompiledContract(baseVerifyInput(tampered));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "no_unplanned_operation")?.passed).toBe(false);
  });

  it("fails when a constraint is loosened (broadened resource binding)", () => {
    const compiled = compile();
    const tampered: CompiledContract = {
      ...compiled,
      allowedActions: compiled.allowedActions.map((a) =>
        a.tool === "github.create_branch"
          ? { ...a, constraints: a.constraints.filter((c) => c.key !== "branch") }
          : a,
      ),
    };
    const result = verifyCompiledContract(baseVerifyInput(tampered));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "constraints_do_not_broaden")?.passed).toBe(false);
  });

  it("fails when an invocation budget is increased beyond what the plan declared", () => {
    const compiled = compile();
    const tampered: CompiledContract = {
      ...compiled,
      allowedActions: compiled.allowedActions.map((a) =>
        a.tool === "github.push_commit" ? { ...a, maxInvocations: 999 } : a,
      ),
    };
    const result = verifyCompiledContract(baseVerifyInput(tampered));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "invocation_budgets_do_not_exceed")?.passed).toBe(false);
  });

  it("fails when expiration exceeds the policy maximum", () => {
    const compiled = compile();
    const tampered: CompiledContract = {
      ...compiled,
      ephemeralLimits: { ...compiled.ephemeralLimits, expiresInSeconds: 999_999 },
    };
    const result = verifyCompiledContract(baseVerifyInput(tampered));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "expiration_within_policy")?.passed).toBe(false);
  });

  it("fails when the output hash is tampered (does not match recomputation)", () => {
    const compiled = compile();
    const tampered: CompiledContract = { ...compiled, outputHash: "f".repeat(64) };
    const result = verifyCompiledContract(baseVerifyInput(tampered));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "output_hash_matches_recomputation")?.passed).toBe(false);
  });

  it("fails when the hash is malformed (not 64 lowercase hex characters)", () => {
    const compiled = compile();
    const tampered: CompiledContract = { ...compiled, outputHash: "not-a-hash" };
    const result = verifyCompiledContract(baseVerifyInput(tampered));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "output_hash_well_formed")?.passed).toBe(false);
  });

  it("fails for an alternate, non-optimal permission selection", () => {
    const compiled = compile();
    // contents_write is a valid but non-optimal cover of the same two
    // operations (see solver.test.ts: branches_write+commits_write wins).
    const tampered: CompiledContract = { ...compiled, selectedPermissionIds: ["github.contents_write"] };
    const result = verifyCompiledContract(baseVerifyInput(tampered));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "selected_permissions_reproduced")?.passed).toBe(false);
  });

  it("fails for an unknown/unsupported registry version", () => {
    const compiled = compile();
    const result = verifyCompiledContract({
      ...baseVerifyInput(compiled),
      supportedRegistryVersions: ["some-other-version"],
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "registry_version_supported")?.passed).toBe(false);
  });

  it("fails for an unknown/unsupported compiler version", () => {
    const compiled = compile();
    const result = verifyCompiledContract({
      ...baseVerifyInput(compiled),
      supportedCompilerVersions: ["some-other-compiler"],
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "compiler_version_supported")?.passed).toBe(false);
  });

  it("fails for a cross-tenant/cross-task reference mismatch", () => {
    const compiled = compile();
    const result = verifyCompiledContract({ ...baseVerifyInput(compiled), taskId: "some_other_task" });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "tenant_task_consistent")?.passed).toBe(false);
  });

  it("names every failing guarantee, not just an overall pass/fail", () => {
    const compiled = compile();
    const tampered: CompiledContract = {
      ...compiled,
      outputHash: "f".repeat(64),
      ephemeralLimits: { ...compiled.ephemeralLimits, expiresInSeconds: 999_999 },
    };
    const result = verifyCompiledContract(baseVerifyInput(tampered));
    const failingCodes = result.checks.filter((c) => !c.passed).map((c) => c.code);
    expect(failingCodes).toContain("output_hash_matches_recomputation");
    expect(failingCodes).toContain("expiration_within_policy");
  });
});
