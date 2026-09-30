import type { CandidatePlan, CandidatePlanNode } from "@/lib/domain";

/**
 * Mechanical backward slice from a plan's own terminal effects.
 *
 * Purely graph-theoretic, no model involved: a "terminal" node is one that nothing else in the accepted node set
 * declares as a dependency or a data-flow source — i.e. a sink in the induced subgraph over `includedNodeIds`. The
 * slice is every node reachable backward from a terminal node via `dependencies` and `dataFlowRefs`, restricted to
 * `includedNodeIds`. A node outside the slice is, by construction of the plan's own declared graph, not needed to
 * produce anything the plan claims to be its actual output — independent of and prior to any Jev necessity
 * evaluation (see `lib/jev/contract-pipeline.ts`, where this is an unconditional rejection, same tier as an unknown
 * registry operation).
 *
 * This is deliberately conservative: a node can only be ruled "outside the slice" by the plan's own dependency
 * declarations, never by inferring an implicit relationship the plan did not state. A plan that fails to declare a
 * real dependency will have that node correctly (if unhelpfully) judged terminal on its own.
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
