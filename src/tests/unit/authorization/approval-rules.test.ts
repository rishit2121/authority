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

function rule(conditions: Policy["conditions"], overrides: Partial<Policy> = {}): Policy {
  return {
    id: "pol_1",
    tenantId: "ten_1",
    name: "rule",
    version: 1,
    status: "active",
    effect: "require_approval",
    conditions,
    requiredApprovalRole: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const refund = node({
  id: "a",
  sequence: 0,
  tool: "stripe.issue_refund",
  arguments: { payment_id: "pay_1", amount_cents: 500 },
  expectedSideEffect: "write_create",
});
const sendEmail = node({
  id: "notify",
  sequence: 0,
  tool: "gmail.send_email",
  arguments: { to: "customer@example.com", subject: "hi" },
  expectedSideEffect: "write_create",
});
const deleteBranch = node({
  id: "a",
  sequence: 0,
  tool: "github.delete_branch",
  arguments: { repository: "r", branch: "stale" },
  expectedSideEffect: "write_delete",
});
const readSecrets = node({
  id: "a",
  sequence: 0,
  tool: "github.get_repository_secrets",
  arguments: { repository: "r" },
  expectedSideEffect: "read",
});
const getIssue = node({ id: "a", sequence: 0, tool: "github.get_issue", arguments: { issue_number: "1" } });

describe("deriveRequiredApprovals", () => {
  describe("with no approval rules, nothing needs approval", () => {
    it.each([
      ["a read", getIssue],
      [
        "a write",
        node({
          id: "a",
          sequence: 0,
          tool: "github.create_branch",
          arguments: { repository: "r", branch: "b" },
          expectedSideEffect: "write_create",
        }),
      ],
      ["a refund (money, confidential)", refund],
      ["an email outside the organization", sendEmail],
      ["a delete", deleteBranch],
      ["secret-classified data", readSecrets],
    ])("%s", (_label, n) => {
      expect(derive(planWith([n]))).toEqual([]);
    });
  });

  describe("an approval rule matches exactly what it names", () => {
    it.each([
      ["money", refund, true],
      ["money", sendEmail, false],
      ["external", sendEmail, true],
      ["external", refund, false],
      ["delete", deleteBranch, true],
      ["delete", refund, false],
      ["sensitive", readSecrets, true],
      ["sensitive", getIssue, false],
      ["write", refund, true],
      ["write", getIssue, false],
      ["read", getIssue, true],
    ] as const)("action=%s", (kind, n, expected) => {
      const requirements = derive(planWith([n]), [rule([{ key: "action", matches: kind }], { name: kind })]);
      expect(requirements.length > 0).toBe(expected);
    });

    it("by tool, by service, and by wildcard", () => {
      expect(
        derive(planWith([refund]), [rule([{ key: "tool", matches: "stripe.issue_refund" }])]),
      ).toHaveLength(1);
      expect(derive(planWith([refund]), [rule([{ key: "provider", matches: "stripe" }])])).toHaveLength(1);
      expect(derive(planWith([refund]), [rule([{ key: "tool", matches: "stripe.*" }])])).toHaveLength(1);
      expect(derive(planWith([refund]), [rule([{ key: "provider", matches: "gmail" }])])).toEqual([]);
    });

    it("every condition of a rule must hold", () => {
      const both = rule([
        { key: "provider", matches: "stripe" },
        { key: "action", matches: "external" },
      ]);
      expect(derive(planWith([refund]), [both])).toEqual([]);
    });

    it("carries the rule's role and count, names the rule, and lets any qualifying member approve", () => {
      const requirements = derive(planWith([refund]), [
        rule([{ key: "action", matches: "money" }], { name: "Money movement", requiredApprovalCount: 2 }),
      ]);
      expect(requirements).toEqual([
        {
          kind: "role",
          role: "admin",
          count: 2,
          selfApprovalAllowed: true,
          reasons: ['approval rule "Money movement" matches stripe.issue_refund'],
        },
      ]);
      expect(() => canonicalHash({ schemaVersion: 1, items: requirements })).not.toThrow();
    });

    it("merges several matching rules for the same role into one requirement", () => {
      const requirements = derive(planWith([refund]), [
        rule([{ key: "action", matches: "money" }], { id: "p1", name: "Money" }),
        rule([{ key: "provider", matches: "stripe" }], { id: "p2", name: "Stripe" }),
      ]);
      expect(requirements).toHaveLength(1);
      expect(requirements[0].reasons).toHaveLength(2);
    });
  });

  it("ignores condition-less rules and allow policies", () => {
    expect(derive(planWith([refund]), [rule([])])).toEqual([]);
    expect(
      derive(planWith([refund]), [
        rule([{ key: "tool", matches: "stripe.issue_refund" }], {
          effect: "allow",
          requiredApprovalRole: undefined,
        }),
      ]),
    ).toEqual([]);
  });

  it("fails closed on a rule it cannot evaluate", () => {
    const requirements = derive(planWith([refund]), [
      rule([{ key: "amount", matches: "*" }], { name: "odd" }),
    ]);
    expect(requirements).toHaveLength(1);
    expect(requirements[0].reasons[0]).toContain("could not be fully evaluated");
  });

  it("fails closed on an admin's deny policy it cannot evaluate", () => {
    const deny = rule([{ key: "amount", matches: "*" }], {
      effect: "deny",
      name: "unreadable deny",
      requiredApprovalRole: undefined,
    });
    const requirements = derive(planWith([getIssue]), [deny]);
    expect(requirements).toEqual([
      expect.objectContaining({ kind: "role", role: "security_admin", selfApprovalAllowed: false }),
    ]);
  });
});
