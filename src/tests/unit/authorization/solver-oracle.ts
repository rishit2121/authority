import { comparePermissionIds } from "@/lib/registry";
import type { SolverInput, SolverObjectiveScore, SolverOutcome } from "@/lib/authorization/solver";

/**
 * Test-only brute-force oracle: genuinely exhaustive enumeration of every
 * subset of the relevant permissions (2^N, no pruning of any kind), used
 * only to independently verify the real branch-and-bound solver in
 * solver.ts. Never imported from production code — its entire value is
 * being a *different* implementation path that the real solver's output
 * must agree with exactly (selected set and full score, not merely
 * coverage), for every generated small registry.
 */

const ORACLE_MAX_PERMISSIONS = 21; // 2^21 = 2,097,152 — fine for a one-off test-time brute force.

function compareScore(a: SolverObjectiveScore, b: SolverObjectiveScore): number {
  return (
    a.excessOperationCount - b.excessOperationCount ||
    a.totalRiskCost - b.totalRiskCost ||
    a.totalResourceBreadth - b.totalResourceBreadth ||
    a.permissionCount - b.permissionCount
  );
}

function compareIdLists(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = comparePermissionIds(a[i], b[i]);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

export function bruteForceMinimumAuthority(input: SolverInput): SolverOutcome {
  const { requiredOperations, registry, forbiddenPermissionIds } = input;

  for (const op of requiredOperations) {
    if (!registry.operations.has(op))
      return { status: "invalid_input", reason: `required operation "${op}" is not in the registry` };
  }

  const requiredSet = new Set(requiredOperations);
  if (requiredSet.size === 0) {
    return {
      status: "solved",
      nodesVisited: 0,
      solution: {
        selectedPermissionIds: [],
        coveredOperations: [],
        excessOperations: [],
        score: { excessOperationCount: 0, totalRiskCost: 0, totalResourceBreadth: 0, permissionCount: 0 },
      },
    };
  }

  const relevantIds = new Set<string>();
  for (const op of requiredSet) {
    for (const permId of registry.operationCoverage.get(op) ?? []) {
      if (!forbiddenPermissionIds.has(permId)) relevantIds.add(permId);
    }
  }

  const relevant = [...relevantIds].sort(comparePermissionIds).map((id) => registry.permissions.get(id)!);
  if (relevant.length > ORACLE_MAX_PERMISSIONS) {
    throw new Error(
      `oracle: ${relevant.length} relevant permissions exceeds the brute-force test harness's own limit of ${ORACLE_MAX_PERMISSIONS}`,
    );
  }

  let best: { selectedIds: string[]; score: SolverObjectiveScore } | null = null;

  const total = 2 ** relevant.length;
  for (let mask = 0; mask < total; mask++) {
    const selected = relevant.filter((_, i) => (mask & (1 << i)) !== 0);
    const covered = new Set<string>();
    for (const p of selected) for (const op of p.operations) covered.add(op);
    if (![...requiredSet].every((op) => covered.has(op))) continue;

    const excess = new Set<string>();
    for (const p of selected) for (const op of p.operations) if (!requiredSet.has(op)) excess.add(op);

    const score: SolverObjectiveScore = {
      excessOperationCount: excess.size,
      totalRiskCost: selected.reduce((s, p) => s + p.riskCost, 0),
      totalResourceBreadth: selected.reduce((s, p) => s + p.resourceBreadth, 0),
      permissionCount: selected.length,
    };
    const selectedIds = selected.map((p) => p.id).sort(comparePermissionIds);

    if (
      !best ||
      compareScore(score, best.score) < 0 ||
      (compareScore(score, best.score) === 0 && compareIdLists(selectedIds, best.selectedIds) < 0)
    ) {
      best = { selectedIds, score };
    }
  }

  if (!best) return { status: "no_valid_solution", nodesVisited: 0 };

  return {
    status: "solved",
    nodesVisited: 0,
    solution: {
      selectedPermissionIds: best.selectedIds,
      coveredOperations: [...requiredSet].sort(),
      excessOperations: (() => {
        const excess = new Set<string>();
        for (const id of best!.selectedIds) {
          const p = registry.permissions.get(id)!;
          for (const op of p.operations) if (!requiredSet.has(op)) excess.add(op);
        }
        return [...excess].sort();
      })(),
      score: best.score,
    },
  };
}

/** Deterministic PRNG (mulberry32) so generated test registries are reproducible without an external dependency. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generates a small random registry with deliberately overlapping permission coverage. */
export function generateRandomRegistry(
  random: () => number,
  operationCount: number,
  permissionCount: number,
): LoadedRegistryInput {
  const operations = Array.from({ length: operationCount }, (_, i) => `op_${i}`);
  const permissions: { id: string; operations: string[]; riskCost: number; resourceBreadth: number }[] = [];

  for (let i = 0; i < permissionCount; i++) {
    const size = 1 + Math.floor(random() * Math.min(4, operationCount));
    const ops = new Set<string>();
    while (ops.size < size) ops.add(operations[Math.floor(random() * operationCount)]);
    permissions.push({
      id: `perm_${i}`,
      operations: [...ops].sort(),
      riskCost: 1 + Math.floor(random() * 10),
      resourceBreadth: 1 + Math.floor(random() * 10),
    });
  }

  // Guarantee every operation has at least one covering permission, so the
  // generated registry always loads (matching loadRegistry's own invariant).
  for (const op of operations) {
    if (!permissions.some((p) => p.operations.includes(op))) {
      permissions.push({
        id: `perm_cover_${op}`,
        operations: [op],
        riskCost: 1 + Math.floor(random() * 10),
        resourceBreadth: 1 + Math.floor(random() * 10),
      });
    }
  }

  return { operations, permissions };
}

export interface LoadedRegistryInput {
  operations: string[];
  permissions: { id: string; operations: string[]; riskCost: number; resourceBreadth: number }[];
}

export function toRegistryData(input: LoadedRegistryInput) {
  return {
    schemaVersion: 1 as const,
    registryVersion: "generated-test-registry",
    operations: input.operations.map((id) => ({
      id: `synthetic.${id}`,
      provider: "synthetic",
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
    })),
    permissions: input.permissions.map((p) => ({
      id: `synthetic.${p.id}`,
      provider: "synthetic",
      operations: p.operations.map((o) => `synthetic.${o}`),
      classification: "read" as const,
      riskCost: p.riskCost,
      resourceBreadth: p.resourceBreadth,
      allowsExternalCommunication: false,
    })),
  };
}
