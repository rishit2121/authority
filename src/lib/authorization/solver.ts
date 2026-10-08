import type { LoadedRegistry, Permission } from "@/lib/registry";
import { comparePermissionIds } from "@/lib/registry";

/**
 * Exact, deterministic minimum-authority solver.
 *
 * What "minimal" means, precisely, and what it does not mean: the selected
 * permission set is lexicographically minimal, under the objective below,
 * among every set that covers every required operation and excludes every
 * policy-forbidden permission. An individual selected permission may still
 * expose operations beyond this task's needs, if the underlying provider's
 * permission granularity forces that — this solver narrows *which
 * permissions are selected*, not what each permission technically allows.
 * Authority's compiled contract (contract-compiler.ts) is what narrows
 * actual runtime use down to exactly the accepted plan's operations,
 * resources and arguments, regardless of what a selected permission exposes.
 *
 * Objective, lexicographic, evaluated in this fixed order — no tier is ever
 * traded off against a later one, and every value is an integer (no floats
 * anywhere in a security-relevant comparison):
 *
 *   1. Minimize the size of the *union* of excess operations exposed by the
 *      selected permissions (operations a selected permission covers beyond
 *      the required set).
 *   2. Minimize total risk cost (sum of selected permissions' `riskCost`).
 *   3. Minimize total resource breadth (sum of `resourceBreadth`).
 *   4. Minimize the number of selected permissions.
 *   5. Tie-break: lexicographically smallest sorted list of permission IDs —
 *      the only place permission *identifiers* (not their content) affect
 *      the outcome, and only after every other tier is tied exactly.
 *
 * Algorithm: forced-permission preprocessing, then exact branch-and-bound.
 * Deliberately does *not* use any "permission A is individually dominated by
 * permission B" heuristic — the earlier draft of this solver did, and it was
 * withdrawn because dominance on a permission's own coverage/cost, in
 * isolation, is not provably safe against a lexicographic objective that
 * scores a *union* of excess operations and *combinations* of permissions: a
 * permission that looks individually dominated may still participate in a
 * globally superior combination. The two pruning rules actually used are
 * each independently sound:
 *
 *   - Feasibility pruning: if even selecting every remaining candidate
 *     cannot cover every still-uncovered required operation, no completion
 *     of this branch can possibly be a solution. This never depends on the
 *     objective at all.
 *   - Bound pruning: every objective tier (1-4) is a monotonically
 *     non-decreasing function of the selected set under set inclusion —
 *     adding a permission can only add to the union of excess operations,
 *     add to the risk/breadth sums, and increase the permission count, never
 *     reduce any of them. The accumulated score at any partial state is
 *     therefore a valid lower bound on the score of *every* completion of
 *     that branch, so a branch already no better than the best complete
 *     solution found so far can be abandoned without exploring further.
 *
 * Both rules are checked against the brute-force oracle for every generated
 * test registry (see solver-oracle.test.ts), not merely asserted.
 *
 * Limits and benchmark (see solver-benchmark.test.ts): `MAX_RELEVANT_PERMISSIONS`
 * is set to 25, based on measuring a deliberately adversarial "ring" registry
 * at that scale (every operation covered by exactly 2 permissions, so
 * forced-permission preprocessing never fires, and near-identical costs, so
 * bound pruning has minimal early signal) — see solver-benchmark.test.ts's
 * own logged node-visit/wall-time numbers at the shipped limit, against a
 * hard cap of `MAX_NODE_VISITS` = 200,000. Raised from 22 to 25 when the
 * audited demo registry's own legitimate "require every non-restricted
 * operation at once" oracle case (solver-oracle.test.ts) grew past 22
 * relevant permissions following the addition of the Linear and Notion
 * connectors — the minimum bump that case needed, re-benchmarked rather than
 * assumed safe, exactly as the previous bump from 20 to 22 was (for
 * `gmail.labels_read`/`gmail.messages_read`). `search_space_exceeded`
 * is returned, with no partial answer, whenever the relevant-permission or
 * required-operation count exceeds its limit, or the node-visit cap is hit
 * mid-search — a distinct outcome from `no_valid_solution` (see the type
 * below): the former means "this exceeded configured limits," the latter
 * means "the full space was searched and no covering, policy-compliant
 * selection exists."
 */

export const MAX_RELEVANT_PERMISSIONS = 25;
export const MAX_REQUIRED_OPERATIONS = 30;
/** A hard, deterministic work limit — counted in branch-and-bound node visits, never wall-clock time. */
export const MAX_NODE_VISITS = 200_000;

export interface SolverObjectiveScore {
  excessOperationCount: number;
  totalRiskCost: number;
  totalResourceBreadth: number;
  permissionCount: number;
}

export interface SolverSolution {
  selectedPermissionIds: string[];
  coveredOperations: string[];
  excessOperations: string[];
  score: SolverObjectiveScore;
}

export type SolverOutcome =
  | { status: "solved"; solution: SolverSolution; nodesVisited: number }
  | { status: "no_valid_solution"; nodesVisited: number }
  | { status: "search_space_exceeded"; reason: string }
  | { status: "invalid_input"; reason: string };

export interface SolverInput {
  requiredOperations: readonly string[];
  registry: LoadedRegistry;
  forbiddenPermissionIds: ReadonlySet<string>;
}

/** Lexicographic comparator over tiers 1-4 only. Negative means `a` is better (smaller). */
function compareScore(a: SolverObjectiveScore, b: SolverObjectiveScore): number {
  return (
    a.excessOperationCount - b.excessOperationCount ||
    a.totalRiskCost - b.totalRiskCost ||
    a.totalResourceBreadth - b.totalResourceBreadth ||
    a.permissionCount - b.permissionCount
  );
}

/** Tier 5: lexicographic comparison of the sorted selected-ID lists themselves. */
function compareIdListsLexicographically(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = comparePermissionIds(a[i], b[i]);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

interface Candidate {
  permission: Permission;
  operations: ReadonlySet<string>;
}

interface Incumbent {
  selectedIds: string[];
  score: SolverObjectiveScore;
}

function isBetter(candidate: Incumbent, incumbent: Incumbent | null): boolean {
  if (!incumbent) return true;
  const cmp = compareScore(candidate.score, incumbent.score);
  if (cmp !== 0) return cmp < 0;
  return (
    compareIdListsLexicographically(
      [...candidate.selectedIds].sort(comparePermissionIds),
      [...incumbent.selectedIds].sort(comparePermissionIds),
    ) < 0
  );
}

export class SearchSpaceExceededError extends Error {}

export function solveMinimumAuthority(input: SolverInput): SolverOutcome {
  const { requiredOperations, registry, forbiddenPermissionIds } = input;

  for (const op of requiredOperations) {
    if (!registry.operations.has(op)) {
      return { status: "invalid_input", reason: `required operation "${op}" is not in the registry` };
    }
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

  if (requiredSet.size > MAX_REQUIRED_OPERATIONS) {
    return {
      status: "search_space_exceeded",
      reason: `${requiredSet.size} required operations exceeds the limit of ${MAX_REQUIRED_OPERATIONS}`,
    };
  }

  // Relevant candidates: cover >=1 required operation and are not policy-forbidden.
  const relevantIds = new Set<string>();
  for (const op of requiredSet) {
    for (const permId of registry.operationCoverage.get(op) ?? []) {
      if (!forbiddenPermissionIds.has(permId)) relevantIds.add(permId);
    }
  }

  if (relevantIds.size > MAX_RELEVANT_PERMISSIONS) {
    return {
      status: "search_space_exceeded",
      reason: `${relevantIds.size} relevant permissions exceeds the limit of ${MAX_RELEVANT_PERMISSIONS}`,
    };
  }

  const allCandidates = new Map<string, Candidate>();
  for (const id of relevantIds) {
    const permission = registry.permissions.get(id)!;
    allCandidates.set(id, { permission, operations: new Set(permission.operations) });
  }

  // Forced-permission preprocessing: an operation covered by exactly one
  // remaining candidate makes that candidate's selection a feasibility
  // requirement, not a choice. Sound regardless of the objective — excluding
  // it would make every solution infeasible.
  const forced: Candidate[] = [];
  const forcedCovered = new Set<string>();
  const remaining = new Map(allCandidates);

  let progress = true;
  while (progress) {
    progress = false;
    for (const op of requiredSet) {
      if (forcedCovered.has(op)) continue;
      const covering = [...remaining.values()].filter((c) => c.operations.has(op));
      if (covering.length === 0) {
        return { status: "no_valid_solution", nodesVisited: 0 };
      }
      if (covering.length === 1) {
        const chosen = covering[0];
        forced.push(chosen);
        for (const o of chosen.operations) forcedCovered.add(o);
        remaining.delete(chosen.permission.id);
        progress = true;
      }
    }
  }

  if ([...requiredSet].every((op) => forcedCovered.has(op))) {
    return buildOutcome(forced, requiredSet, 0);
  }

  const stillUncovered = [...requiredSet].filter((op) => !forcedCovered.has(op));

  // Deterministic search order: most-still-useful first (performance only —
  // correctness never depends on this order), ties broken by permission ID.
  const orderedRemaining = [...remaining.values()].sort((a, b) => {
    const usefulA = [...a.operations].filter((o) => stillUncovered.includes(o)).length;
    const usefulB = [...b.operations].filter((o) => stillUncovered.includes(o)).length;
    return usefulB - usefulA || comparePermissionIds(a.permission.id, b.permission.id);
  });

  const forcedExcess = new Set<string>();
  for (const c of forced) for (const o of c.operations) if (!requiredSet.has(o)) forcedExcess.add(o);
  const forcedRisk = forced.reduce((sum, c) => sum + c.permission.riskCost, 0);
  const forcedBreadth = forced.reduce((sum, c) => sum + c.permission.resourceBreadth, 0);
  const forcedIds = forced.map((c) => c.permission.id);

  let best: Incumbent | null = null;
  let nodesVisited = 0;

  function search(
    index: number,
    coveredOps: ReadonlySet<string>,
    excessSet: ReadonlySet<string>,
    totalRiskCost: number,
    totalResourceBreadth: number,
    selectedIds: readonly string[],
  ): void {
    nodesVisited++;
    if (nodesVisited > MAX_NODE_VISITS) {
      throw new SearchSpaceExceededError(`exceeded ${MAX_NODE_VISITS} branch-and-bound node visits`);
    }

    const score: SolverObjectiveScore = {
      excessOperationCount: excessSet.size,
      totalRiskCost,
      totalResourceBreadth,
      permissionCount: selectedIds.length,
    };

    // Correctness-critical: check that every *required* operation is present
    // in coveredOps, never `coveredOps.size === requiredSet.size`. coveredOps
    // also accumulates excess operations from selected permissions, so an
    // excess operation can inflate its size to coincidentally match
    // requiredSet.size while a genuinely required operation remains
    // uncovered — exactly the bug the brute-force oracle caught.
    const stillNeeded = [...requiredSet].filter((op) => !coveredOps.has(op));

    if (stillNeeded.length === 0) {
      // Fully covered: this is a complete candidate solution. Adding more
      // permissions from here could only tie or worsen every tier, by
      // monotonicity — never explore further down this branch.
      if (isBetter({ selectedIds: [...selectedIds], score }, best)) {
        best = { selectedIds: [...selectedIds], score };
      }
      return;
    }

    if (index === orderedRemaining.length) return; // exhausted without full coverage: infeasible leaf.

    if (best && compareScore(score, best.score) >= 0) return; // sound bound prune (see module doc).

    const achievable = new Set<string>();
    for (let i = index; i < orderedRemaining.length; i++) {
      for (const op of orderedRemaining[i].operations) achievable.add(op);
    }
    if (!stillNeeded.every((op) => achievable.has(op))) return; // sound feasibility prune.

    const candidate = orderedRemaining[index];

    // Branch: select this candidate.
    const newCovered = new Set(coveredOps);
    const newExcess = new Set(excessSet);
    for (const op of candidate.operations) {
      newCovered.add(op);
      if (!requiredSet.has(op)) newExcess.add(op);
    }
    search(
      index + 1,
      newCovered,
      newExcess,
      totalRiskCost + candidate.permission.riskCost,
      totalResourceBreadth + candidate.permission.resourceBreadth,
      [...selectedIds, candidate.permission.id],
    );

    // Branch: skip this candidate.
    search(index + 1, coveredOps, excessSet, totalRiskCost, totalResourceBreadth, selectedIds);
  }

  try {
    search(0, forcedCovered, forcedExcess, forcedRisk, forcedBreadth, forcedIds);
  } catch (error) {
    if (error instanceof SearchSpaceExceededError) {
      return { status: "search_space_exceeded", reason: error.message };
    }
    throw error;
  }

  if (!best) return { status: "no_valid_solution", nodesVisited };

  const finalIds = (best as Incumbent).selectedIds;
  const selectedCandidates = finalIds.map((id) => allCandidates.get(id)!);
  return buildOutcome(selectedCandidates, requiredSet, nodesVisited);
}

function buildOutcome(
  selected: Candidate[],
  requiredSet: ReadonlySet<string>,
  nodesVisited: number,
): SolverOutcome {
  const excess = new Set<string>();
  for (const c of selected) for (const op of c.operations) if (!requiredSet.has(op)) excess.add(op);
  const selectedIds = selected.map((c) => c.permission.id).sort(comparePermissionIds);
  return {
    status: "solved",
    nodesVisited,
    solution: {
      selectedPermissionIds: selectedIds,
      coveredOperations: [...requiredSet].sort(),
      excessOperations: [...excess].sort(),
      score: {
        excessOperationCount: excess.size,
        totalRiskCost: selected.reduce((s, c) => s + c.permission.riskCost, 0),
        totalResourceBreadth: selected.reduce((s, c) => s + c.permission.resourceBreadth, 0),
        permissionCount: selected.length,
      },
    },
  };
}
