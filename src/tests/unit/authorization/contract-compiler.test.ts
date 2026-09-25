import { describe, expect, it } from "vitest";

import type { CandidatePlan } from "@/lib/domain";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

import { compileContract } from "@/lib/authorization/contract-compiler";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";

const registry = loadRegistry(githubDemoRegistry);

const ISSUE_991_PLAN: CandidatePlan = {
  schemaVersion: 1,
  taskId: "task_991",
  nodes: [
    {
      id: "read-issue",
      sequence: 0,
      tool: "github.get_issue",
      arguments: { issue_number: "991" },
      dependencies: [],
      declaredOutputs: [],
      dataFlowRefs: [],
      expectedSideEffect: "read",
      maxInvocations: 1,
    },
    {
      id: "create-branch",
      sequence: 1,
      tool: "github.create_branch",
      arguments: { repository: "payments-api", branch: "fix-991" },
      dependencies: ["read-issue"],
      declaredOutputs: [],
      dataFlowRefs: [],
      expectedSideEffect: "write_create",
      maxInvocations: 1,
    },
    {
      id: "push-commit",
      sequence: 2,
      tool: "github.push_commit",
      arguments: { repository: "payments-api", branch: "fix-991" },
      dependencies: ["create-branch"],
      declaredOutputs: [],
      dataFlowRefs: [],
      expectedSideEffect: "write_update",
      maxInvocations: 5,
    },
  ],
};

function compileIssue991() {
  const validation = validateCandidatePlan(ISSUE_991_PLAN, { registry, activePolicies: [] });
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
  return {
    validation,
    solverOutcome,
    contract: compileContract({ candidatePlan: ISSUE_991_PLAN, validation, solverOutcome, registry }),
  };
}

describe("compileContract", () => {
  it("compiles exactly the accepted operations, no more", () => {
    const { contract } = compileIssue991();
    expect(contract.allowedActions.map((a) => a.tool).sort()).toEqual([
      "github.create_branch",
      "github.get_issue",
      "github.push_commit",
    ]);
  });

  it("narrows constraints to exactly the plan's concrete argument values", () => {
    const { contract } = compileIssue991();
    const createBranch = contract.allowedActions.find((a) => a.tool === "github.create_branch")!;
    expect(createBranch.constraints).toEqual([
      { key: "branch", equals: "fix-991" },
      { key: "repository", equals: "payments-api" },
    ]);
  });

  it("sums per-tool invocation counts across nodes calling the same tool", () => {
    const { contract } = compileIssue991();
    const pushCommit = contract.allowedActions.find((a) => a.tool === "github.push_commit")!;
    expect(pushCommit.maxInvocations).toBe(5);
    expect(contract.ephemeralLimits.maxToolInvocations).toBe(1 + 1 + 5);
  });

  it("reports the solver's excess operations and selected permissions without hiding them", () => {
    const { contract } = compileIssue991();
    expect(contract.selectedPermissionIds.length).toBeGreaterThan(0);
    expect(Array.isArray(contract.excessOperations)).toBe(true);
  });

  it("produces a 64-character lowercase hex input and output hash", () => {
    const { contract } = compileIssue991();
    expect(contract.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(contract.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("excludes a denied node's tool from allowedActions entirely (no unplanned operation)", () => {
    const planWithSecret: CandidatePlan = {
      ...ISSUE_991_PLAN,
      nodes: [
        ...ISSUE_991_PLAN.nodes,
        {
          id: "get-secret",
          sequence: 3,
          tool: "github.get_repository_secrets",
          arguments: { repository: "payments-api" },
          dependencies: [],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: "read",
          maxInvocations: 1,
        },
      ],
    };
    const activePolicies = [
      {
        id: "p",
        tenantId: "t",
        name: "Never read repository secrets",
        version: 1,
        status: "active" as const,
        effect: "deny" as const,
        conditions: [{ key: "resource", matches: "*secret*" }],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const validation = validateCandidatePlan(planWithSecret, { registry, activePolicies });
    const solverOutcome = solveMinimumAuthority({
      requiredOperations: validation.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
    const contract = compileContract({ candidatePlan: planWithSecret, validation, solverOutcome, registry });

    expect(contract.allowedActions.some((a) => a.tool === "github.get_repository_secrets")).toBe(false);
    expect(contract.forbiddenOperations).toContain("github.get_repository_secrets");
  });

  it("throws when there are no accepted nodes to compile", () => {
    const emptyPlan: CandidatePlan = {
      schemaVersion: 1,
      taskId: "task_x",
      nodes: [
        {
          id: "a",
          sequence: 0,
          tool: "github.does_not_exist",
          arguments: {},
          dependencies: [],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: "read",
          maxInvocations: 1,
        },
      ],
    };
    const validation = validateCandidatePlan(emptyPlan, { registry, activePolicies: [] });
    const solverOutcome = solveMinimumAuthority({
      requiredOperations: validation.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
    expect(() =>
      compileContract({ candidatePlan: emptyPlan, validation, solverOutcome, registry }),
    ).toThrow();
  });

  it("produces byte-identical hashes across repeated compilations of the same input", () => {
    const first = compileIssue991().contract;
    const second = compileIssue991().contract;
    expect(first.inputHash).toBe(second.inputHash);
    expect(first.outputHash).toBe(second.outputHash);
  });
});
