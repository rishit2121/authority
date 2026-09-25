import { describe, expect, it } from "vitest";

import type { CandidatePlan, Policy } from "@/lib/domain";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

import { PlanStructureError, validateCandidatePlan } from "@/lib/authorization/plan-validator";

const registry = loadRegistry(githubDemoRegistry);

const NO_SECRETS_POLICY: Policy = {
  id: "pol_no_secrets",
  tenantId: "ten_1",
  name: "Never read repository secrets",
  version: 1,
  status: "active",
  effect: "deny",
  conditions: [{ key: "resource", matches: "*secret*" }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

function basePlan(nodes: CandidatePlan["nodes"]): CandidatePlan {
  return { schemaVersion: 1, taskId: "task_1", nodes };
}

function node(
  overrides: Partial<CandidatePlan["nodes"][number]> &
    Pick<CandidatePlan["nodes"][number], "id" | "sequence" | "tool">,
) {
  return {
    arguments: {},
    dependencies: [],
    declaredOutputs: [],
    dataFlowRefs: [],
    expectedSideEffect: "read" as const,
    maxInvocations: 1,
    ...overrides,
  };
}

describe("validateCandidatePlan — structural failures (throw, whole plan rejected)", () => {
  it("rejects duplicate node ids", () => {
    const plan = basePlan([
      node({ id: "a", sequence: 0, tool: "github.get_issue", arguments: { issue_number: "1" } }),
      node({ id: "a", sequence: 1, tool: "github.get_issue", arguments: { issue_number: "1" } }),
    ]);
    expect(() => validateCandidatePlan(plan, { registry, activePolicies: [] })).toThrow(PlanStructureError);
  });

  it("rejects duplicate sequence numbers", () => {
    const plan = basePlan([
      node({ id: "a", sequence: 0, tool: "github.get_issue", arguments: { issue_number: "1" } }),
      node({ id: "b", sequence: 0, tool: "github.read_repository", arguments: { repository: "r" } }),
    ]);
    expect(() => validateCandidatePlan(plan, { registry, activePolicies: [] })).toThrow(PlanStructureError);
  });

  it("rejects a dependency on an unknown node", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "github.get_issue",
        arguments: { issue_number: "1" },
        dependencies: ["ghost"],
      }),
    ]);
    expect(() => validateCandidatePlan(plan, { registry, activePolicies: [] })).toThrow(PlanStructureError);
  });

  it("rejects a dependency cycle (a depends on b, b depends on a — expressed via non-increasing sequence)", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "github.get_issue",
        arguments: { issue_number: "1" },
        dependencies: ["b"],
      }),
      node({
        id: "b",
        sequence: 1,
        tool: "github.read_repository",
        arguments: { repository: "r" },
        dependencies: ["a"],
      }),
    ]);
    // a's dependency on b: b's sequence (1) is not strictly earlier than a's (0) — rejected.
    expect(() => validateCandidatePlan(plan, { registry, activePolicies: [] })).toThrow(PlanStructureError);
  });

  it("rejects a forward data-flow reference", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "github.create_branch",
        arguments: { repository: "r" },
        dataFlowRefs: [{ argumentKey: "branch", fromNodeId: "b", output: "branch_name" }],
      }),
      node({
        id: "b",
        sequence: 1,
        tool: "github.get_issue",
        arguments: { issue_number: "1" },
        declaredOutputs: ["branch_name"],
      }),
    ]);
    expect(() => validateCandidatePlan(plan, { registry, activePolicies: [] })).toThrow(PlanStructureError);
  });

  it("rejects a data-flow reference to an output the source node never declared", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "github.get_issue",
        arguments: { issue_number: "1" },
        declaredOutputs: ["issue_title"],
      }),
      node({
        id: "b",
        sequence: 1,
        tool: "github.create_branch",
        arguments: { repository: "r" },
        dataFlowRefs: [{ argumentKey: "branch", fromNodeId: "a", output: "not_declared" }],
      }),
    ]);
    expect(() => validateCandidatePlan(plan, { registry, activePolicies: [] })).toThrow(PlanStructureError);
  });
});

describe("validateCandidatePlan — per-node findings", () => {
  it("denies an unknown operation", () => {
    const plan = basePlan([node({ id: "a", sequence: 0, tool: "github.delete_organization" })]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.findings).toEqual([
      {
        nodeId: "a",
        status: "denied",
        reasons: ['"github.delete_organization" is not in the trusted registry'],
      },
    ]);
    expect(result.acceptedNodeIds).toEqual([]);
  });

  it("flags an unrecognized argument key for replan", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "github.get_issue",
        arguments: { issue_number: "1", bogus_key: "x" },
      }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.findings[0].status).toBe("replan");
  });

  it("flags a wrong-typed argument for replan", () => {
    const plan = basePlan([
      node({ id: "a", sequence: 0, tool: "github.get_issue", arguments: { issue_number: 991 } }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.findings[0].status).toBe("replan");
  });

  it("asks for clarification on a missing required, non-resource argument", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "github.create_branch",
        arguments: { repository: "r" },
        expectedSideEffect: "write_create",
      }),
    ]);
    // "branch" is required but not resource-identifying.
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.findings[0].status).toBe("clarify");
    expect(result.findings[0].reasons[0]).toMatch(/missing required argument "branch"/);
  });

  it("asks for clarification when a resource-identifying argument is unbound", () => {
    const plan = basePlan([node({ id: "a", sequence: 0, tool: "github.get_issue", arguments: {} })]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.findings[0].status).toBe("clarify");
    expect(result.findings[0].reasons[0]).toMatch(
      /resource-identifying argument "issue_number" is not bound/,
    );
  });

  it("accepts a resource-identifying argument bound via data-flow instead of a concrete value", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "github.read_repository",
        arguments: { repository: "payments-api" },
        declaredOutputs: ["repo_id"],
      }),
      node({
        id: "b",
        sequence: 1,
        tool: "github.get_issue",
        arguments: {},
        dataFlowRefs: [{ argumentKey: "issue_number", fromNodeId: "a", output: "repo_id" }],
      }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.findings.map((f) => f.status)).toEqual(["accepted", "accepted"]);
  });

  it("denies a declared side-effect mismatch against the registry", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "github.get_issue",
        arguments: { issue_number: "1" },
        expectedSideEffect: "write_create",
      }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.findings[0].status).toBe("denied");
    expect(result.findings[0].reasons[0]).toMatch(/does not match the registry/);
  });

  it("rejects github.get_repository_secrets via the demo tenant's active deny policy", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "github.get_repository_secrets",
        arguments: { repository: "payments-api" },
      }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [NO_SECRETS_POLICY] });
    expect(result.findings[0].status).toBe("denied");
    expect(result.findings[0].reasons[0]).toMatch(/forbidden by policy "Never read repository secrets"/);
    expect(result.acceptedNodeIds).toEqual([]);
    expect(result.requiredOperations).toEqual([]);
  });

  it("requires review for external communication, unconditionally", () => {
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "gmail.send_email",
        arguments: { to: "customer@example.com", subject: "hi" },
        expectedSideEffect: "write_create",
      }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.findings[0].status).toBe("requires_review");
  });

  it("reports the most severe finding when multiple rules apply to one node", () => {
    // Unknown argument key (replan) AND external communication (requires_review) on the same node — denied/replan/etc precedence should surface "replan" here since no "denied" rule fires.
    const plan = basePlan([
      node({
        id: "a",
        sequence: 0,
        tool: "gmail.send_email",
        arguments: { to: "x", subject: "y", bogus: "z" },
        expectedSideEffect: "write_create",
      }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.findings[0].status).toBe("replan");
  });

  it("only carries accepted nodes' operations forward, deduplicated and sorted", () => {
    const plan = basePlan([
      node({ id: "a", sequence: 0, tool: "github.get_issue", arguments: { issue_number: "1" } }),
      node({ id: "b", sequence: 1, tool: "github.get_issue", arguments: { issue_number: "2" } }),
      node({ id: "c", sequence: 2, tool: "github.read_repository", arguments: { repository: "r" } }),
      node({ id: "d", sequence: 3, tool: "github.delete_organization" }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(result.acceptedNodeIds).toEqual(["a", "b", "c"]);
    expect(result.requiredOperations).toEqual(["github.get_issue", "github.read_repository"]);
  });

  it("ignores an allow-effect policy entirely — it grants nothing", () => {
    const allowPolicy: Policy = { ...NO_SECRETS_POLICY, id: "pol_allow", effect: "allow" };
    const plan = basePlan([
      node({ id: "a", sequence: 0, tool: "github.get_repository_secrets", arguments: { repository: "r" } }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [allowPolicy] });
    // Still findable/deniable only via the tool being registry-valid; no deny policy present, so it's accepted here —
    // demonstrating an allow policy does not itself grant or protect anything.
    expect(result.findings[0].status).toBe("accepted");
  });

  it("treats an unsupported policy key on a deny policy as requires_review, not a silent pass", () => {
    const weirdPolicy: Policy = {
      ...NO_SECRETS_POLICY,
      conditions: [{ key: "argument_value" as never, matches: "*secret*" }],
    };
    const plan = basePlan([
      node({ id: "a", sequence: 0, tool: "github.get_issue", arguments: { issue_number: "1" } }),
    ]);
    const result = validateCandidatePlan(plan, { registry, activePolicies: [weirdPolicy] });
    expect(result.findings[0].status).toBe("requires_review");
  });
});
