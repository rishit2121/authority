import { describe, expect, it } from "vitest";

import { computeBackwardSlice } from "@/lib/authorization/backward-slice";
import type { CandidatePlan } from "@/lib/domain";

const node = (over: Partial<CandidatePlan["nodes"][number]>) => ({
  id: "n",
  sequence: 0,
  tool: "github.get_issue",
  arguments: {},
  dependencies: [],
  declaredOutputs: [],
  dataFlowRefs: [],
  expectedSideEffect: "read" as const,
  maxInvocations: 1,
  ...over,
});
const plan = (nodes: CandidatePlan["nodes"]): CandidatePlan => ({ schemaVersion: 1, taskId: "t", nodes });

describe("computeBackwardSlice", () => {
  it("a single node is its own terminal and its own slice", () => {
    const p = plan([node({ id: "a" })]);
    const r = computeBackwardSlice(p, ["a"]);
    expect(r).toEqual({ terminalNodeIds: ["a"], inSliceNodeIds: ["a"], outsideSliceNodeIds: [] });
  });

  it("a linear chain: only the sink is terminal, every node is in slice", () => {
    const p = plan([
      node({ id: "a", sequence: 0 }),
      node({ id: "b", sequence: 1, dependencies: ["a"] }),
      node({ id: "c", sequence: 2, dependencies: ["b"] }),
    ]);
    const r = computeBackwardSlice(p, ["a", "b", "c"]);
    expect(r.terminalNodeIds).toEqual(["c"]);
    expect(r.inSliceNodeIds.sort()).toEqual(["a", "b", "c"]);
    expect(r.outsideSliceNodeIds).toEqual([]);
  });

  it("a node nothing depends on is its own terminal, so it stays in the slice (the slice cannot flag it)", () => {
    // b is consumed by c (the real terminal effect); a is a dangling read no one uses.
    const p = plan([
      node({ id: "a", sequence: 0 }),
      node({ id: "b", sequence: 1 }),
      node({ id: "c", sequence: 2, dependencies: ["b"] }),
    ]);
    const r = computeBackwardSlice(p, ["a", "b", "c"]);
    expect(r.terminalNodeIds.sort()).toEqual(["a", "c"]);
    expect(r.outsideSliceNodeIds).toEqual([]); // a is its own terminal (nothing declared it a dependency)
  });

  it("a data-flow-only relationship counts as a dependency edge for slicing", () => {
    const p = plan([
      node({ id: "a", sequence: 0, declaredOutputs: ["issue_body"] }),
      node({
        id: "b",
        sequence: 1,
        dataFlowRefs: [{ argumentKey: "body", fromNodeId: "a", output: "issue_body" }],
      }),
    ]);
    const r = computeBackwardSlice(p, ["a", "b"]);
    expect(r.terminalNodeIds).toEqual(["b"]);
    expect(r.inSliceNodeIds.sort()).toEqual(["a", "b"]);
  });

  it("two disjoint terminal branches: both are their own roots, both fully in slice", () => {
    const p = plan([
      node({ id: "a", sequence: 0 }),
      node({ id: "b", sequence: 1, dependencies: ["a"] }),
      node({ id: "x", sequence: 2 }),
    ]);
    const r = computeBackwardSlice(p, ["a", "b", "x"]);
    expect(r.terminalNodeIds.sort()).toEqual(["b", "x"]);
    expect(r.outsideSliceNodeIds).toEqual([]);
  });

  it("a node excluded from includedNodeIds (e.g. denied) is never pulled into the slice and never a valid edge target", () => {
    const p = plan([node({ id: "a", sequence: 0 }), node({ id: "b", sequence: 1, dependencies: ["a"] })]);
    // "a" was denied mechanically and is not in includedNodeIds, even though b still lists it as a dependency.
    const r = computeBackwardSlice(p, ["b"]);
    expect(r.terminalNodeIds).toEqual(["b"]);
    expect(r.inSliceNodeIds).toEqual(["b"]);
    expect(r.outsideSliceNodeIds).toEqual([]);
  });

  it("an unused side branch that only fed an excluded node becomes its own terminal and stays in the slice", () => {
    // d is a duplicate/unused read: only e (excluded — imagine denied) would have consumed it.
    const p = plan([
      node({ id: "a", sequence: 0 }),
      node({ id: "d", sequence: 1 }),
      node({ id: "e", sequence: 2, dependencies: ["d"] }),
      node({ id: "f", sequence: 3, dependencies: ["a"] }),
    ]);
    const r = computeBackwardSlice(p, ["a", "d", "f"]); // "e" excluded
    expect(r.terminalNodeIds.sort()).toEqual(["d", "f"]); // d has no included dependent, so it's its own terminal
    expect(r.outsideSliceNodeIds).toEqual([]);
  });
});

/**
 * The slice starts from every sink. In a finite acyclic graph every node reaches some sink, so every included node
 * is in the slice and `outsideSliceNodeIds` is always empty: the slice cannot tell a needed step from an unneeded
 * one. Deciding necessity would need anchors grounded outside the plan (outputs the trusted task or application
 * declares), which Authority does not have. These tests pin the actual behavior so no claim can drift from it.
 */
describe("computeBackwardSlice cannot establish necessity", () => {
  it("keeps a disconnected, unrelated write in the slice", () => {
    const p = plan([
      node({ id: "read", sequence: 0, tool: "gmail.get_message" }),
      node({
        id: "reply",
        sequence: 1,
        tool: "slack.post_message",
        dependencies: ["read"],
        expectedSideEffect: "write_create",
      }),
      node({ id: "unrelated", sequence: 2, tool: "stripe.issue_refund", expectedSideEffect: "write_create" }),
    ]);
    const r = computeBackwardSlice(p, ["read", "reply", "unrelated"]);
    expect(r.inSliceNodeIds).toContain("unrelated");
    expect(r.outsideSliceNodeIds).toEqual([]);
  });

  it("returns an empty outside set for every acyclic plan (500 random DAGs)", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 500; trial++) {
      const size = 1 + Math.floor(rand() * 12);
      const nodes = Array.from({ length: size }, (_, i) =>
        node({
          id: `n${i}`,
          sequence: i,
          // edges only point to strictly earlier nodes, as the validator requires
          dependencies: Array.from({ length: i }, (_, j) => `n${j}`).filter(() => rand() < 0.25),
        }),
      );
      const ids = nodes.map((n) => n.id).filter(() => rand() < 0.85);
      const r = computeBackwardSlice(plan(nodes), ids);
      expect(r.outsideSliceNodeIds).toEqual([]);
      expect(r.inSliceNodeIds).toEqual(ids);
    }
  });
});
