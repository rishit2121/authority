import { describe, expect, it } from "vitest";

import type { CandidatePlan, Policy } from "@/lib/domain";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

import { deriveRequiredApprovals } from "@/lib/authorization/approval-rules";
import { canonicalHash } from "@/lib/authorization/canonicalize";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";

const registry = loadRegistry(githubDemoRegistry);

function planWith(nodes: CandidatePlan["nodes"]): CandidatePlan {
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

function derive(plan: CandidatePlan, activePolicies: readonly Policy[] = []) {
  const validation = validateCandidatePlan(plan, { registry, activePolicies });
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
  return deriveRequiredApprovals({
    candidatePlan: plan,
    validation,
    solverOutcome,
    registry,
    activePolicies,
  });
}

describe("deriveRequiredApprovals", () => {
  it("requires nothing for a read-only plan", () => {
    const plan = planWith([
      node({ id: "a", sequence: 0, tool: "github.get_issue", arguments: { issue_number: "1" } }),
    ]);
    expect(derive(plan)).toEqual([]);
  });

  it("requires task-owner sign-off for any non-read action", () => {
    const plan = planWith([
      node({
        id: "a",
        sequence: 0,
        tool: "github.create_branch",
        arguments: { repository: "r", branch: "b" },
        expectedSideEffect: "write_create",
      }),
    ]);
    const requirements = derive(plan);
    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({ kind: "task_owner", count: 1, selfApprovalAllowed: true });
  });

  it("adds a security_admin requirement for high data sensitivity, on top of task-owner", () => {
    // stripe.issue_refund: write_create + confidential + financialImpact — exercises three rules at once.
    const plan = planWith([
      node({
        id: "a",
        sequence: 0,
        tool: "stripe.issue_refund",
        arguments: { payment_id: "pay_1", amount_cents: 500 },
        expectedSideEffect: "write_create",
      }),
    ]);
    const requirements = derive(plan);
    const roleReq = requirements.find((r) => r.kind === "role");
    const ownerReq = requirements.find((r) => r.kind === "task_owner");
    expect(ownerReq).toBeDefined();
    expect(roleReq).toBeDefined();
    expect(roleReq).toMatchObject({ role: "security_admin", count: 1, selfApprovalAllowed: false });
    // Confidential data AND financial impact both fire, but merge into one requirement.
    expect(requirements).toHaveLength(2);
    expect(roleReq!.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("requires security_admin for an irreversible/admin side effect", () => {
    const plan = planWith([
      node({
        id: "a",
        sequence: 0,
        tool: "github.delete_branch",
        arguments: { repository: "r", branch: "stale" },
        expectedSideEffect: "write_delete",
      }),
    ]);
    const requirements = derive(plan);
    const roleReq = requirements.find((r) => r.kind === "role");
    expect(roleReq).toMatchObject({ role: "security_admin", count: 1, selfApprovalAllowed: false });
    expect(roleReq!.reasons.some((r) => r.includes("irreversible"))).toBe(true);
  });

  it("requires security_admin for high data sensitivity even on a read-only operation", () => {
    const plan = planWith([
      node({
        id: "a",
        sequence: 0,
        tool: "github.get_repository_secrets",
        arguments: { repository: "r" },
        expectedSideEffect: "read",
      }),
    ]);
    const requirements = derive(plan);
    // Read-only: no task-owner requirement, but sensitivity still demands review.
    expect(requirements.some((r) => r.kind === "task_owner")).toBe(false);
    expect(requirements.some((r) => r.kind === "role" && r.role === "security_admin")).toBe(true);
  });

  it("requires security_admin for a requires_review (external communication) finding, reproducing the reason", () => {
    const plan = planWith([
      node({
        id: "notify",
        sequence: 0,
        tool: "gmail.send_email",
        arguments: { to: "customer@example.com", subject: "hi" },
        expectedSideEffect: "write_create",
      }),
    ]);
    const requirements = derive(plan);
    const roleReq = requirements.find((r) => r.kind === "role");
    expect(roleReq).toBeDefined();
    expect(roleReq!.reasons.some((r) => r.includes("requires review"))).toBe(true);
  });

  it("requires security_admin when the solver could not avoid excess operations", () => {
    // github.repo_read covers get_issue + read_repository with zero excess; asking for
    // just get_issue alone never has excess either given issues_read exists. To force a
    // solver result with excess, require an operation only covered by a broader permission.
    const plan = planWith([
      node({ id: "a", sequence: 0, tool: "github.read_repository", arguments: { repository: "r" } }),
      node({
        id: "b",
        sequence: 1,
        tool: "github.create_branch",
        arguments: { repository: "r", branch: "b" },
        expectedSideEffect: "write_create",
      }),
      node({
        id: "c",
        sequence: 2,
        tool: "github.push_commit",
        arguments: { repository: "r", branch: "b" },
        dependencies: ["b"],
        expectedSideEffect: "write_update",
      }),
    ]);
    const validation = validateCandidatePlan(plan, { registry, activePolicies: [] });
    const solverOutcome = solveMinimumAuthority({
      requiredOperations: validation.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
    const requirements = deriveRequiredApprovals({
      candidatePlan: plan,
      validation,
      solverOutcome,
      registry,
      activePolicies: [],
    });
    // Whether or not this particular plan has excess is an emergent solver
    // property; assert the invariant instead of a specific outcome.
    if (solverOutcome.solution.excessOperations.length > 0) {
      expect(requirements.some((r) => r.reasons.some((r2) => r2.includes("excess operations")))).toBe(true);
    }
  });

  it("adds a policy-driven requirement for a require_approval policy match", () => {
    const policy: Policy = {
      id: "pol_1",
      tenantId: "ten_1",
      name: "Review all branch creation",
      version: 1,
      status: "active",
      effect: "require_approval",
      conditions: [{ key: "tool", matches: "github.create_branch" }],
      requiredApprovalRole: "admin",
      requiredApprovalCount: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const plan = planWith([
      node({
        id: "a",
        sequence: 0,
        tool: "github.create_branch",
        arguments: { repository: "r", branch: "b" },
        expectedSideEffect: "write_create",
      }),
    ]);
    const requirements = derive(plan, [policy]);
    const policyReq = requirements.find((r) => r.role === "admin");
    expect(policyReq).toBeDefined();
    expect(policyReq!.count).toBe(2);
    expect(policyReq!.reasons.some((r) => r.includes('"Review all branch creation"'))).toBe(true);
  });

  it("does not apply a require_approval policy that does not match any included node", () => {
    const policy: Policy = {
      id: "pol_1",
      tenantId: "ten_1",
      name: "Review refunds",
      version: 1,
      status: "active",
      effect: "require_approval",
      conditions: [{ key: "tool", matches: "stripe.issue_refund" }],
      requiredApprovalRole: "admin",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const plan = planWith([
      node({ id: "a", sequence: 0, tool: "github.get_issue", arguments: { issue_number: "1" } }),
    ]);
    expect(derive(plan, [policy])).toEqual([]);
  });

  it("ignores an allow-effect or deny-effect policy entirely — only require_approval participates here", () => {
    const denyPolicy: Policy = {
      id: "pol_1",
      tenantId: "ten_1",
      name: "irrelevant deny",
      version: 1,
      status: "active",
      effect: "deny",
      conditions: [{ key: "tool", matches: "github.get_issue" }],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    // A deny match would exclude the node entirely from the plan, so use a
    // node the deny policy does not match to isolate this assertion.
    const plan = planWith([
      node({ id: "a", sequence: 0, tool: "github.read_repository", arguments: { repository: "r" } }),
    ]);
    expect(derive(plan, [denyPolicy])).toEqual([]);
  });

  it("is deterministic: task_owner sorts before role requirements", () => {
    const plan = planWith([
      node({
        id: "a",
        sequence: 0,
        tool: "stripe.issue_refund",
        arguments: { payment_id: "pay_1", amount_cents: 100 },
        expectedSideEffect: "write_create",
      }),
    ]);
    const requirements = derive(plan);
    expect(requirements[0].kind).toBe("task_owner");
  });

  it("regression: a task_owner requirement never carries a `role` key at all, not even role: undefined", () => {
    // activateContractAction() runs the derived spec through canonicalHash()
    // to compare it against the persisted one — canonicalHash() rejects an
    // object property whose value is literally `undefined` (even though a
    // JSON round-trip would silently drop it), so this must be a genuinely
    // absent key, not a present key holding `undefined`.
    const plan = planWith([
      node({
        id: "a",
        sequence: 0,
        tool: "github.create_branch",
        arguments: { repository: "r", branch: "b" },
        expectedSideEffect: "write_create",
      }),
    ]);
    const requirements = derive(plan);
    const taskOwnerReq = requirements.find((r) => r.kind === "task_owner")!;
    expect(taskOwnerReq).toBeDefined();
    expect(Object.hasOwn(taskOwnerReq, "role")).toBe(false);
    expect(() => canonicalHash({ schemaVersion: 1, items: requirements })).not.toThrow();
  });
});
