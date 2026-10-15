import "server-only";

import type {
  ApprovalRequirement,
  ApprovalRequirementKind,
  CandidatePlan,
  Policy,
  TenantRole,
} from "@/lib/domain";
import type { LoadedRegistry } from "@/lib/registry";

import { actionKindsOf, evaluatePolicyCondition, isApprovalRuleKey } from "./policy-conditions";
import { evaluateActivePolicies, type PlanValidationResult } from "./plan-validator";
import type { SolverOutcome } from "./solver";

/**
 * Deterministic derivation of what human sign-off a compiled contract needs
 * before it may ever activate.
 *
 * Approval is the organization's call, not Authority's: a contract needs
 * sign-off only when one of the tenant's own approval rules (active
 * `require_approval` policies, managed on the dashboard's Approval rules
 * page) matches an operation it includes. With no rules, nothing needs
 * approval -- every contract activates as soon as it is compiled, and every
 * individual call is still checked against it at runtime exactly as before.
 * What a contract allows is decided entirely upstream (validator, solver,
 * compiler); this module never adds or removes an operation, it only decides
 * who must bless the contract that was already compiled.
 *
 * The one requirement that does not come from an approval rule is a fail-
 * closed one: an active *deny* policy that cannot be fully evaluated against
 * an included operation (an unsupported key, a malformed pattern) might
 * have been meant to forbid it, so a security_admin must confirm. Silently
 * skipping an admin's own uninterpretable deny would widen authority.
 *
 * Multiple rules that resolve to the same (kind, role, selfApprovalAllowed)
 * are merged into one requirement, taking the *maximum* count among them
 * and concatenating every contributing reason.
 *
 * `ApprovalRequirement`/`ApprovalRequirementKind` are domain types (see
 * `lib/domain/task-authority-contract.ts`), not defined here — a persisted
 * contract's own shape carries this deriver's output verbatim.
 */

export interface DeriveRequiredApprovalsInput {
  candidatePlan: CandidatePlan;
  validation: PlanValidationResult;
  solverOutcome: Extract<SolverOutcome, { status: "solved" }>;
  registry: LoadedRegistry;
  /** Only the tenant's currently-active policies — the caller resolves that, this function does not query anything. */
  activePolicies: readonly Policy[];
}

interface DraftRequirement {
  kind: ApprovalRequirementKind;
  role: TenantRole | undefined;
  count: number;
  selfApprovalAllowed: boolean;
  reason: string;
}

function mergeDrafts(drafts: readonly DraftRequirement[]): ApprovalRequirement[] {
  const byKey = new Map<string, ApprovalRequirement>();

  for (const draft of drafts) {
    const key = `${draft.kind}:${draft.role ?? ""}:${draft.selfApprovalAllowed}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        kind: draft.kind,
        // Omitted entirely, not set to `undefined`, when there is no role
        // (the "task_owner" kind): canonicalHash() — used to compare a
        // recomputed requirements spec against the persisted one during
        // activation re-verification — rejects `undefined` as an
        // unrecognized JSON-unsafe value.
        ...(draft.role ? { role: draft.role } : {}),
        count: draft.count,
        selfApprovalAllowed: draft.selfApprovalAllowed,
        reasons: [draft.reason],
      });
      continue;
    }
    existing.count = Math.max(existing.count, draft.count);
    if (!existing.reasons.includes(draft.reason)) existing.reasons.push(draft.reason);
  }

  // Deterministic order: task_owner first, then role tiers ascending, then
  // by whether self-approval is allowed — never insertion order.
  const ROLE_ORDER: TenantRole[] = ["viewer", "developer", "security_admin", "admin", "owner"];
  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "task_owner" ? -1 : 1;
    const aRank = a.role ? ROLE_ORDER.indexOf(a.role) : -1;
    const bRank = b.role ? ROLE_ORDER.indexOf(b.role) : -1;
    if (aRank !== bRank) return aRank - bRank;
    return a.selfApprovalAllowed === b.selfApprovalAllowed ? 0 : a.selfApprovalAllowed ? 1 : -1;
  });
}

type Operation = NonNullable<ReturnType<LoadedRegistry["operations"]["get"]>>;

/** true = matches, false = doesn't, null = can't be evaluated (treated as a match: fail closed). */
function ruleMatches(policy: Policy, tool: string, operation: Operation): boolean | null {
  let evaluable = true;
  for (const condition of policy.conditions) {
    if (!isApprovalRuleKey(condition.key)) {
      evaluable = false;
      continue;
    }
    const candidates =
      condition.key === "tool"
        ? [tool]
        : condition.key === "provider"
          ? [tool.split(".")[0]]
          : condition.key === "resource"
            ? [operation.resourceType]
            : actionKindsOf(operation);
    const results = candidates.map((c) => evaluatePolicyCondition(condition.matches, c));
    if (results.some((r) => r === true)) continue;
    if (results.some((r) => r === null)) evaluable = false;
    else return false;
  }
  return evaluable ? true : null;
}

/**
 * Derives the full set of approval requirements a compiled contract's
 * content demands. Returns an empty array when no rule matches — "no
 * approval required" is the default, first-class outcome.
 */
export function deriveRequiredApprovals(input: DeriveRequiredApprovalsInput): ApprovalRequirement[] {
  const { candidatePlan, validation, registry, activePolicies } = input;

  const includedIds = new Set(validation.includedNodeIds);
  const includedNodes = candidatePlan.nodes.filter((n) => includedIds.has(n.id));

  const drafts: DraftRequirement[] = [];

  for (const node of includedNodes) {
    const operation = registry.operations.get(node.tool);
    if (!operation) continue;

    // The organization's approval rules. A rule with no conditions matches
    // nothing (it would otherwise put every task behind approval by accident).
    for (const policy of activePolicies) {
      if (policy.effect !== "require_approval" || !policy.requiredApprovalRole) continue;
      if (policy.conditions.length === 0) continue;
      const match = ruleMatches(policy, node.tool, operation);
      if (match === false) continue;
      drafts.push({
        kind: "role",
        role: policy.requiredApprovalRole,
        count: policy.requiredApprovalCount ?? 1,
        // Any qualifying member may approve, including whoever submitted it:
        // a workspace with a single admin must be able to act on its own rules.
        selfApprovalAllowed: true,
        reason:
          match === true
            ? `approval rule "${policy.name}" matches ${node.tool}`
            : `approval rule "${policy.name}" could not be fully evaluated and may apply to ${node.tool}`,
      });
    }

    // Fail closed on an admin's deny policy this build cannot interpret.
    const deny = evaluateActivePolicies(node, operation.resourceType, activePolicies);
    if (deny?.status === "requires_review") {
      drafts.push({
        kind: "role",
        role: "security_admin",
        count: 1,
        selfApprovalAllowed: false,
        reason: `plan node "${node.id}" requires review: ${deny.reasons.join("; ")}`,
      });
    }
  }

  return mergeDrafts(drafts);
}
