import { describe, expect, it } from "vitest";

import {
  planInputToInsertRow,
  planNodeRowToDomain,
  planNodesToInsertRows,
  planRowsToDomain,
} from "@/lib/persistence/mappers/plan";
import type { Tables } from "@/lib/persistence/db-types";

const PLAN_ROW: Tables<"plans"> = {
  id: "pl000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  task_id: "ta000000-0000-4000-8000-000000000001",
  version: 1,
  status: "proposed",
  submitted_by: null,
  model_metadata: { schemaVersion: 1 },
  proposed_at: "2026-01-01T00:00:00.000Z",
  demo_key: "demo:plan:991",
  created_at: "2026-01-01T00:00:00.000Z",
  idempotency_key: null,
  input_hash: null,
};

function nodeRow(overrides: Partial<Tables<"plan_nodes">> = {}): Tables<"plan_nodes"> {
  return {
    id: "no000000-0000-4000-8000-000000000001",
    tenant_id: PLAN_ROW.tenant_id,
    plan_id: PLAN_ROW.id,
    node_key: "read-issue",
    sequence_no: 0,
    tool: "github.read_issue",
    operation: "read_issue",
    resource: "payments-api#991",
    normalized_arguments: { schemaVersion: 1, values: { issue: "991" } },
    dependencies: [],
    expected_effect: null,
    execution_order: null,
    status: "executed",
    rationale: null,
    demo_key: "demo:node:991:1",
    created_at: "2026-01-01T00:00:00.000Z",
    declared_outputs: null,
    data_flow_refs: null,
    max_invocations: null,
    validation_status: null,
    ...overrides,
  };
}

describe("planNodeRowToDomain", () => {
  it("maps sequence_no to sequence and unwraps normalized_arguments.values", () => {
    expect(planNodeRowToDomain(nodeRow())).toEqual({
      id: "no000000-0000-4000-8000-000000000001",
      sequence: 0,
      tool: "github.read_issue",
      arguments: { issue: "991" },
      status: "executed",
    });
  });

  it("carries rationale when present", () => {
    const domain = planNodeRowToDomain(nodeRow({ rationale: "Matches forbidden resource." }));
    expect(domain.rationale).toBe("Matches forbidden resource.");
  });

  it("drops node_key, operation, resource, dependencies and execution_order", () => {
    const domain = planNodeRowToDomain(nodeRow());
    for (const key of ["nodeKey", "operation", "resource", "dependencies", "executionOrder"]) {
      expect(domain).not.toHaveProperty(key);
    }
  });

  it("rejects an unrecognized normalized_arguments schema version", () => {
    expect(() =>
      planNodeRowToDomain(nodeRow({ normalized_arguments: { schemaVersion: 7, values: {} } })),
    ).toThrow();
  });
});

describe("planRowsToDomain", () => {
  it("assembles nodes nested under the plan, sorted by sequence_no", () => {
    const nodes = [
      nodeRow({ id: "n2", sequence_no: 1, tool: "github.read_repository" }),
      nodeRow({ id: "n1", sequence_no: 0 }),
    ];

    const domain = planRowsToDomain(PLAN_ROW, nodes);

    expect(domain.id).toBe(PLAN_ROW.id);
    expect(domain.taskId).toBe(PLAN_ROW.task_id);
    expect(domain.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("sorts nodes by sequence regardless of the order they were passed in", () => {
    const nodes = [
      nodeRow({ id: "third", sequence_no: 2 }),
      nodeRow({ id: "first", sequence_no: 0 }),
      nodeRow({ id: "second", sequence_no: 1 }),
    ];
    const domain = planRowsToDomain(PLAN_ROW, nodes);
    expect(domain.nodes.map((n) => n.id)).toEqual(["first", "second", "third"]);
  });

  it("does not mutate the caller's node array", () => {
    const nodes = [nodeRow({ id: "b", sequence_no: 1 }), nodeRow({ id: "a", sequence_no: 0 })];
    const original = [...nodes];
    planRowsToDomain(PLAN_ROW, nodes);
    expect(nodes).toEqual(original);
  });

  it("rejects a plan with no nodes, since the domain requires at least one", () => {
    expect(() => planRowsToDomain(PLAN_ROW, [])).toThrow();
  });
});

describe("planInputToInsertRow / planNodesToInsertRows", () => {
  it("builds a plan insert row", () => {
    const row = planInputToInsertRow({ tenantId: PLAN_ROW.tenant_id, taskId: PLAN_ROW.task_id });
    expect(row).toEqual({ tenant_id: PLAN_ROW.tenant_id, task_id: PLAN_ROW.task_id, proposed_at: undefined });
  });

  it("builds node insert rows once the plan id is known, deriving operation from the tool", () => {
    const rows = planNodesToInsertRows(PLAN_ROW.id, PLAN_ROW.tenant_id, [
      { sequence: 0, tool: "github.read_issue", arguments: { issue: "991" } },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].plan_id).toBe(PLAN_ROW.id);
    expect(rows[0].operation).toBe("read_issue");
    expect(rows[0].normalized_arguments).toEqual({ schemaVersion: 1, values: { issue: "991" } });
  });
});
