import { describe, expect, it } from "vitest";

import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

import { MAX_RELEVANT_PERMISSIONS, solveMinimumAuthority } from "@/lib/authorization/solver";

const registry = loadRegistry(githubDemoRegistry);

function solve(requiredOperations: string[], forbidden: string[] = []) {
  return solveMinimumAuthority({ requiredOperations, registry, forbiddenPermissionIds: new Set(forbidden) });
}

describe("solveMinimumAuthority — the registry's designed scenarios", () => {
  it("narrow scope beats broad scope on the first tier (excess operations)", () => {
    const outcome = solve(["github.get_issue"]);
    if (outcome.status !== "solved") throw new Error(outcome.status);
    expect(outcome.solution.selectedPermissionIds).toEqual(["github.issues_read"]);
    expect(outcome.solution.excessOperations).toEqual([]);
  });

  it("two narrow scopes beat one broader scope when the objective requires it", () => {
    const outcome = solve(["github.create_branch", "github.push_commit"]);
    if (outcome.status !== "solved") throw new Error(outcome.status);
    expect(outcome.solution.selectedPermissionIds).toEqual(["github.branches_write", "github.commits_write"]);
    expect(outcome.solution.score.totalRiskCost).toBe(4); // 2 + 2, beating contents_write's 5
  });

  it("broad scope wins only when objectively minimal under the documented ordering", () => {
    const outcome = solve(["github.get_issue", "github.read_repository"]);
    if (outcome.status !== "solved") throw new Error(outcome.status);
    expect(outcome.solution.selectedPermissionIds).toEqual(["github.repo_read"]);
    expect(outcome.solution.score.totalRiskCost).toBe(2); // beats issues_read(1)+repository_read(2)=3
  });

  it("resolves multiple equivalent optima deterministically by permission ID", () => {
    const outcome = solve(["github.get_issue"]);
    if (outcome.status !== "solved") throw new Error(outcome.status);
    // issues_read and issues_read_alt tie on every scored tier; issues_read sorts first.
    expect(outcome.solution.selectedPermissionIds).toEqual(["github.issues_read"]);
  });

  it("covers every required operation exactly", () => {
    const outcome = solve([
      "github.get_issue",
      "github.create_branch",
      "github.push_commit",
      "github.create_pull_request",
    ]);
    if (outcome.status !== "solved") throw new Error(outcome.status);
    expect(outcome.solution.coveredOperations).toEqual(
      ["github.create_branch", "github.create_pull_request", "github.get_issue", "github.push_commit"].sort(),
    );
  });

  // A registry-level "zero coverage" case is unreachable here by construction:
  // loadRegistry() itself refuses to load a registry with an uncovered
  // operation (see registry.test.ts). The real way "no covering permission
  // remains" arises is after policy forbids every permission that covered
  // it, exercised next.
  it("fails closed when policy forbids every permission that could cover a required operation", () => {
    const outcome = solve(["github.get_repository_secrets"], ["github.secrets_read", "github.repo_admin"]);
    expect(outcome.status).toBe("no_valid_solution");
  });

  it("excludes a policy-forbidden permission from the search even when it would otherwise be selected", () => {
    // Forbidding contents_write must not change the branches+commits result, but forbidding branches_write should force contents_write instead.
    const outcome = solve(["github.create_branch", "github.push_commit"], ["github.branches_write"]);
    if (outcome.status !== "solved") throw new Error(outcome.status);
    expect(outcome.solution.selectedPermissionIds).toEqual(["github.contents_write"]);
  });

  it("rejects a required operation absent from the registry as invalid input", () => {
    const outcome = solve(["github.does_not_exist"]);
    expect(outcome.status).toBe("invalid_input");
  });

  it("returns the trivial solved-empty solution for zero required operations", () => {
    const outcome = solve([]);
    if (outcome.status !== "solved") throw new Error(outcome.status);
    expect(outcome.solution.selectedPermissionIds).toEqual([]);
  });

  it("fails closed with search_space_exceeded when relevant permissions exceed the registry limit", () => {
    const operations = Array.from({ length: MAX_RELEVANT_PERMISSIONS + 5 }, (_, i) => ({
      id: `synthetic.op_${i}`,
      provider: "synthetic",
      sideEffect: "read" as const,
      resourceType: "thing",
      dataSensitivity: "internal" as const,
      externalCommunication: false,
      requiresApproval: false,
      argumentFields: [],
    }));
    const permissions = operations.map((op, i) => ({
      id: `synthetic.perm_${i}`,
      provider: "synthetic",
      operations: [op.id],
      classification: "read" as const,
      riskCost: 1,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    }));
    const bigRegistry = loadRegistry({
      schemaVersion: 1,
      registryVersion: "synthetic-oversized",
      operations,
      permissions,
    });
    const outcome = solveMinimumAuthority({
      requiredOperations: operations.map((o) => o.id),
      registry: bigRegistry,
      forbiddenPermissionIds: new Set(),
    });
    expect(outcome.status).toBe("search_space_exceeded");
  });
});

describe("solveMinimumAuthority — determinism", () => {
  it("produces byte-equivalent normalized output across repeated runs", () => {
    const runs = Array.from({ length: 5 }, () =>
      solve(["github.create_branch", "github.push_commit", "github.get_issue"]),
    );
    const serialized = runs.map((r) => JSON.stringify(r));
    expect(new Set(serialized).size).toBe(1);
  });
});
