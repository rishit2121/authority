import type { CandidatePlan, CandidatePlanNode } from "@/lib/domain";

/**
 * Backward slice from a plan's sinks: a structural utility, NOT a necessity check.
 *
 * A "terminal" node is one that nothing else in `includedNodeIds` declares as a dependency or data-flow source (a
 * sink of the induced subgraph); the slice is everything reachable backward from those sinks. Because the slice
 * starts from every sink, and every node of a finite acyclic graph reaches some sink, every included node of a
 * validated plan is in the slice and `outsideSliceNodeIds` is always empty. An unneeded step -- even a disconnected,
 * unrelated write -- is simply its own sink. The slice therefore cannot show that any step is unnecessary, and no
 * claim of "mechanical necessity" may rest on it. Deciding necessity would need effect anchors grounded outside the
 * plan (outputs the trusted task or application policy declares), which Authority does not have today; a model
 * choosing anchors would be probabilistic interpretation, not proof. See backward-slice.test.ts for the property.
 */
export interface BackwardSliceResult {
  /** Node ids with no other included node depending on them (dependency or data-flow) — the plan's own declared outputs. */
  terminalNodeIds: string[];
  /** Every node id reachable backward from a terminal node, restricted to `includedNodeIds`. Always a superset of `terminalNodeIds`. */
  inSliceNodeIds: string[];
  /** `includedNodeIds` minus `inSliceNodeIds` — mechanically unnecessary to any of the plan's own terminal effects. */
  outsideSliceNodeIds: string[];
}

export function computeBackwardSlice(
  plan: CandidatePlan,
  includedNodeIds: readonly string[],
): BackwardSliceResult {
  const included = new Set(includedNodeIds);
  const byId = new Map<string, CandidatePlanNode>(plan.nodes.map((n) => [n.id, n]));

  const hasDependent = new Set<string>();
  for (const node of plan.nodes) {
    if (!included.has(node.id)) continue;
    for (const depId of node.dependencies) if (included.has(depId)) hasDependent.add(depId);
    for (const ref of node.dataFlowRefs) if (included.has(ref.fromNodeId)) hasDependent.add(ref.fromNodeId);
  }
  const terminalNodeIds = includedNodeIds.filter((id) => !hasDependent.has(id));

  const inSlice = new Set<string>();
  const stack = [...terminalNodeIds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (inSlice.has(id) || !included.has(id)) continue;
    inSlice.add(id);
    const node = byId.get(id);
    if (!node) continue;
    for (const depId of node.dependencies) if (included.has(depId)) stack.push(depId);
    for (const ref of node.dataFlowRefs) if (included.has(ref.fromNodeId)) stack.push(ref.fromNodeId);
  }

  return {
    terminalNodeIds,
    inSliceNodeIds: includedNodeIds.filter((id) => inSlice.has(id)),
    outsideSliceNodeIds: includedNodeIds.filter((id) => !inSlice.has(id)),
  };
}
