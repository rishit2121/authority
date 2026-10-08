import { comparePermissionIds } from "@/lib/registry";
import type { Permission } from "@/lib/registry";
import type { SolverInput, SolverObjectiveScore, SolverOutcome } from "@/lib/authorization/solver";

/**
 * Test-only brute-force oracle: genuinely exhaustive enumeration of every
 * subset of the relevant permissions (2^N, no pruning of any kind), used
 * only to independently verify the real branch-and-bound solver in
 * solver.ts. Never imported from production code — its entire value is
 * being a *different* implementation path that the real solver's output
 * must agree with exactly (selected set and full score, not merely
 * coverage), for every generated small registry.
 *
 * Brute-forces per connected component, not the whole relevant set at once.
 * Two permissions are connected when they share an operation (directly or
 * transitively); a real connector's own permissions never cover another
 * connector's operations, so e.g. github's ~13 relevant permissions and
 * linear's 2 are independent components, not one combined 2^15 search. This
 * is exact, not an approximation: every score field here (excess operation
 * count, risk cost, resource breadth, permission count) is a plain sum over
 * the selected permissions, and a required operation is only ever covered by
 * permissions in its own component — so solving each component separately
 * and summing the scores gives exactly the same answer as one combined
 * search would, without the combinatorial blowup of treating unrelated
 * connectors as one search space (which is what started failing here the
 * moment a registry with multiple small, disjoint connector families grew
 * past ORACLE_MAX_PERMISSIONS in total, even though no single family did).
 */

const ORACLE_MAX_PERMISSIONS = 21; // 2^21 = 2,097,152 — fine for a one-off test-time brute force, per component.

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(x: string): string {
    const existing = this.parent.get(x);
    if (existing === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (existing === x) return x;
    const root = this.find(existing);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

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

  const uf = new UnionFind();
  for (const p of relevant) {
    uf.union(`perm:${p.id}`, `perm:${p.id}`);
    for (const op of p.operations) uf.union(`perm:${p.id}`, `op:${op}`);
  }

  const requiredOpsByComponent = new Map<string, Set<string>>();
  for (const op of requiredSet) {
    const root = uf.find(`op:${op}`);
    if (!requiredOpsByComponent.has(root)) requiredOpsByComponent.set(root, new Set());
    requiredOpsByComponent.get(root)!.add(op);
  }

  const permsByComponent = new Map<string, Permission[]>();
  for (const p of relevant) {
    const root = uf.find(`perm:${p.id}`);
    if (!permsByComponent.has(root)) permsByComponent.set(root, []);
    permsByComponent.get(root)!.push(p);
  }

  let totalExcessCount = 0;
  let totalRiskCost = 0;
  let totalResourceBreadth = 0;
  let totalPermissionCount = 0;
  const allSelectedIds: string[] = [];
  const allExcessOps = new Set<string>();

  for (const [root, requiredOpsInComponent] of requiredOpsByComponent) {
    const componentPerms = permsByComponent.get(root) ?? [];
    if (componentPerms.length > ORACLE_MAX_PERMISSIONS) {
      throw new Error(
        `oracle: a connected component of ${componentPerms.length} relevant permissions exceeds the brute-force test harness's own limit of ${ORACLE_MAX_PERMISSIONS}`,
      );
    }
    const best = bruteForceComponent(componentPerms, requiredOpsInComponent);
    if (!best) return { status: "no_valid_solution", nodesVisited: 0 };
    totalExcessCount += best.score.excessOperationCount;
    totalRiskCost += best.score.totalRiskCost;
    totalResourceBreadth += best.score.totalResourceBreadth;
    totalPermissionCount += best.score.permissionCount;
    allSelectedIds.push(...best.selectedIds);
    for (const op of best.excessOps) allExcessOps.add(op);
  }

  return {
    status: "solved",
    nodesVisited: 0,
    solution: {
      selectedPermissionIds: allSelectedIds.sort(comparePermissionIds),
      coveredOperations: [...requiredSet].sort(),
      excessOperations: [...allExcessOps].sort(),
      score: {
        excessOperationCount: totalExcessCount,
        totalRiskCost,
        totalResourceBreadth,
        permissionCount: totalPermissionCount,
      },
    },
  };
}

/** Exhaustive 2^N search restricted to one connected component's own relevant permissions and required operations. */
function bruteForceComponent(
  relevant: Permission[],
  requiredSet: Set<string>,
): { selectedIds: string[]; score: SolverObjectiveScore; excessOps: string[] } | null {
  let best: { selectedIds: string[]; score: SolverObjectiveScore; excessOps: string[] } | null = null;

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
      best = { selectedIds, score, excessOps: [...excess] };
    }
  }
  return best;
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
