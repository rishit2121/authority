import { describe, expect, it } from "vitest";

import { loadRegistry, type RegistryData } from "@/lib/registry";

import { MAX_RELEVANT_PERMISSIONS, solveMinimumAuthority } from "@/lib/authorization/solver";

/**
 * Benchmark, not a correctness test — measures actual branch-and-bound work
 * on a deliberately adversarial registry: every operation is covered by
 * exactly 2 permissions (never 1, so forced-permission preprocessing never
 * fires) arranged in a ring, with near-identical costs (no permission
 * dominates another), so the bound-pruning has minimal early signal and the
 * search is forced to do real combinatorial work. This is the "adversarial
 * 20-permission case" the design review asked to be benchmarked before
 * finalizing MAX_RELEVANT_PERMISSIONS, run here at exactly the shipped
 * limit.
 */
function buildAdversarialRegistry(permCount: number): RegistryData {
  const operations = Array.from({ length: permCount }, (_, i) => ({
    id: `adv.op_${i}`,
    provider: "adv",
    sideEffect: "read" as const,
    resourceType: "thing",
    dataSensitivity: "internal" as const,
    externalCommunication: false,
    requiresApproval: false,
    financialImpact: false,
    argumentFields: [],
    preconditions: [],
    effects: [],
    alternativeOperationIds: [],
  }));

  const opsPerPerm = 2;
  const permissions = Array.from({ length: permCount }, (_, i) => ({
    id: `adv.perm_${i}`,
    provider: "adv",
    operations: Array.from({ length: opsPerPerm }, (_, k) => `adv.op_${(i + k) % permCount}`),
    classification: "read" as const,
    riskCost: 4 + (i % 3),
    resourceBreadth: 4 + ((i * 5) % 3),
    allowsExternalCommunication: false,
  }));

  return { schemaVersion: 1, registryVersion: "adversarial-benchmark", operations, permissions };
}

describe("solver benchmark — adversarial ring registry", () => {
  it(`measures node visits and wall time at the shipped limit (${MAX_RELEVANT_PERMISSIONS} permissions)`, () => {
    const registry = loadRegistry(buildAdversarialRegistry(MAX_RELEVANT_PERMISSIONS));
    const requiredOperations = [...registry.operations.keys()];

    const start = performance.now();
    const outcome = solveMinimumAuthority({
      requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    const elapsedMs = performance.now() - start;

    if (outcome.status !== "solved") throw new Error(`expected solved, got ${outcome.status}`);

    console.log(
      `[solver benchmark] ${MAX_RELEVANT_PERMISSIONS} permissions, ring adversarial: ` +
        `${outcome.nodesVisited} node visits, ${elapsedMs.toFixed(2)}ms, ` +
        `selected=${outcome.solution.selectedPermissionIds.length} permissions`,
    );

    // Regression guard, not a correctness claim: this specific adversarial
    // shape must stay comfortably within budget and complete quickly. If a
    // future change to the pruning logic makes this regress substantially,
    // this test catches it.
    expect(outcome.nodesVisited).toBeLessThan(50_000);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("measures the absolute worst case: zero pruning signal at all (uniform cost, ring coverage)", () => {
    // Same ring shape, but every permission has *identical* cost — bound
    // pruning can only fire once a complete solution matching the eventual
    // optimum's cost is found, not before, since nothing distinguishes
    // partial states by score alone until enough of the ring is committed.
    const registry = loadRegistry({
      ...buildAdversarialRegistry(MAX_RELEVANT_PERMISSIONS),
      permissions: buildAdversarialRegistry(MAX_RELEVANT_PERMISSIONS).permissions.map((p) => ({
        ...p,
        riskCost: 5,
        resourceBreadth: 5,
      })),
    });
    const requiredOperations = [...registry.operations.keys()];

    const start = performance.now();
    const outcome = solveMinimumAuthority({
      requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    const elapsedMs = performance.now() - start;

    if (outcome.status !== "solved") throw new Error(`expected solved, got ${outcome.status}`);

    console.log(
      `[solver benchmark] ${MAX_RELEVANT_PERMISSIONS} permissions, uniform-cost ring (worst case for bound pruning): ` +
        `${outcome.nodesVisited} node visits, ${elapsedMs.toFixed(2)}ms`,
    );

    expect(outcome.nodesVisited).toBeLessThan(200_000);
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
