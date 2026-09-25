import "server-only";

import type {
  ApprovalRequirement,
  ApprovalRequirementKind,
  CandidatePlan,
  Policy,
  TenantRole,
} from "@/lib/domain";
import type { LoadedRegistry } from "@/lib/registry";

import { evaluatePolicyCondition, isSupportedPolicyKey } from "./policy-conditions";
import type { PlanValidationResult } from "./plan-validator";
import type { SolverOutcome } from "./solver";

/**
 * Deterministic derivation of what human sign-off a compiled contract needs
 * before it may ever activate.
 *
 * This module runs *after* the plan validator and solver, never influences
 * either of them, and never changes what operations a contract contains —
 * it only decides who must bless the contract that was already compiled.
 * Nothing here is an LLM, nothing here reads model output, and nothing here
 * can turn a denied operation into an accepted one or override a validator
 * finding: a "requires_review" finding is read-only input, reproduced
 * verbatim in the resulting requirement's `reasons`, never resolved or
 * dismissed by this code.
 *
 * Two distinct requirement kinds:
 *
 *  - "task_owner": satisfied only by the specific principal the task itself
 *    is attributed to (`tasks.principal_id`), not by role rank. This is the
 *    one human who unconditionally may approve their own task's contract —
 *    self-approval prevention (below) never applies to this kind.
 *  - "role": satisfied by *any* principal holding at least the named role
 *    rank in the tenant, subject to `selfApprovalAllowed`.
 *
 * Multiple rules that resolve to the same (kind, role, selfApprovalAllowed)
 * are merged into one requirement, taking the *maximum* count among them
 * and concatenating every contributing reason — "three unrelated reasons
 * each wanting one security_admin approval" is one requirement needing one
 * approval with three reasons, not a demand for three separate approvals.
 * A policy that names a strictly higher count for that same tier raises it.
 *
 * `ApprovalRequirement`/`ApprovalRequirementKind` are domain types (see
 * `lib/domain/task-authority-contract.ts`), not defined here — a persisted
 * contract's own shape carries this deriver's output verbatim, and domain
 * types must stay importable from anywhere, including client code that only
 * displays it.
 */

export interface DeriveRequiredApprovalsInput {
  candidatePlan: CandidatePlan;
  validation: PlanValidationResult;
  solverOutcome: Extract<SolverOutcome, { status: "solved" }>;
  registry: LoadedRegistry;
  /** Only the tenant's currently-active policies — the caller resolves that, this function does not query anything. */
  activePolicies: readonly Policy[];
}

const HIGH_SENSITIVITY = new Set(["confidential", "secret"]);
const IRREVERSIBLE_SIDE_EFFECTS = new Set(["write_delete", "admin"]);

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
        role: draft.role,
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
  // by whether self-approval is allowed — never insertion order, which
  // would depend on which rule happened to fire first.
  const ROLE_ORDER: TenantRole[] = ["viewer", "developer", "security_admin", "admin", "owner"];
  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "task_owner" ? -1 : 1;
    const aRank = a.role ? ROLE_ORDER.indexOf(a.role) : -1;
    const bRank = b.role ? ROLE_ORDER.indexOf(b.role) : -1;
    if (aRank !== bRank) return aRank - bRank;
    return a.selfApprovalAllowed === b.selfApprovalAllowed ? 0 : a.selfApprovalAllowed ? 1 : -1;
  });
}

/**
 * Derives the full set of approval requirements a compiled contract's
 * content demands. Returns an empty array when nothing in the plan warrants
 * one — "no approval required" is a real, first-class outcome, not an
 * omission.
 */
export function deriveRequiredApprovals(input: DeriveRequiredApprovalsInput): ApprovalRequirement[] {
  const { candidatePlan, validation, solverOutcome, registry, activePolicies } = input;

  const includedIds = new Set(validation.includedNodeIds);
  const includedNodes = candidatePlan.nodes.filter((n) => includedIds.has(n.id));

  const drafts: DraftRequirement[] = [];

  // Rule 1: task-owner sign-off for any material (non-read) action.
  const hasNonReadEffect = includedNodes.some((n) => n.expectedSideEffect !== "read");
  if (hasNonReadEffect) {
    drafts.push({
      kind: "task_owner",
      role: undefined,
      count: 1,
      selfApprovalAllowed: true,
      reason: "this task performs at least one non-read action; its own owner must confirm it",
    });
  }

  // Rule 2: irreversible or administrative operations additionally need a
  // security-tier sign-off, distinct from the task owner's.
  const hasIrreversible = includedNodes.some((n) => {
    const op = registry.operations.get(n.tool);
    return op !== undefined && IRREVERSIBLE_SIDE_EFFECTS.has(op.sideEffect);
  });
  if (hasIrreversible) {
    drafts.push({
      kind: "role",
      role: "security_admin",
      count: 1,
      selfApprovalAllowed: false,
      reason: "the plan includes an irreversible or administrative operation",
    });
  }

  // Rule 3: high data sensitivity.
  const hasHighSensitivity = includedNodes.some((n) => {
    const op = registry.operations.get(n.tool);
    return op !== undefined && HIGH_SENSITIVITY.has(op.dataSensitivity);
  });
  if (hasHighSensitivity) {
    drafts.push({
      kind: "role",
      role: "security_admin",
      count: 1,
      selfApprovalAllowed: false,
      reason: "the plan touches confidential or secret data",
    });
  }

  // Rule 4: financial impact, unconditionally.
  const hasFinancialImpact = includedNodes.some(
    (n) => registry.operations.get(n.tool)?.financialImpact === true,
  );
  if (hasFinancialImpact) {
    drafts.push({
      kind: "role",
      role: "security_admin",
      count: 1,
      selfApprovalAllowed: false,
      reason: "the plan includes a financial operation",
    });
  }

  // Rule 5: every validator "requires_review" finding — reproduced
  // verbatim, never resolved here. Covers external communication and any
  // other unconditional-review case the validator ever adds.
  const reviewFindings = validation.findings.filter((f) => f.status === "requires_review");
  for (const finding of reviewFindings) {
    drafts.push({
      kind: "role",
      role: "security_admin",
      count: 1,
      selfApprovalAllowed: false,
      reason: `plan node "${finding.nodeId}" requires review: ${finding.reasons.join("; ")}`,
    });
  }

  // Rule 6: the solver could not avoid excess operations on some selected
  // permission — a human should confirm the extra exposure is acceptable.
  if (solverOutcome.solution.excessOperations.length > 0) {
    drafts.push({
      kind: "role",
      role: "security_admin",
      count: 1,
      selfApprovalAllowed: false,
      reason: `the minimum-authority solver could not avoid excess operations: ${solverOutcome.solution.excessOperations.join(", ")}`,
    });
  }

  // Rule 7: organization policy, effect "require_approval". Evaluated
  // per included node against the same closed {tool, resource, provider}
  // vocabulary plan-validator.ts uses for deny policies — but this never
  // touches plan validation; it is read only here.
  for (const policy of activePolicies) {
    if (policy.effect !== "require_approval") continue;
    if (!policy.requiredApprovalRole) continue;

    for (const node of includedNodes) {
      const operation = registry.operations.get(node.tool);
      if (!operation) continue;

      let allSupported = true;
      let allMatch = true;
      for (const condition of policy.conditions) {
        if (!isSupportedPolicyKey(condition.key)) {
          allSupported = false;
          continue;
        }
        const candidateValue =
          condition.key === "tool"
            ? node.tool
            : condition.key === "resource"
              ? operation.resourceType
              : node.tool.split(".")[0];
        const result = evaluatePolicyCondition(condition.matches, candidateValue);
        if (result === null) allSupported = false;
        else if (!result) allMatch = false;
      }

      // An org policy the deriver cannot fully evaluate fails closed here
      // too: it becomes a requirement rather than being silently skipped.
      if (policy.conditions.length > 0 && allMatch && allSupported) {
        drafts.push({
          kind: "role",
          role: policy.requiredApprovalRole,
          count: policy.requiredApprovalCount ?? 1,
          selfApprovalAllowed: false,
          reason: `organization policy "${policy.name}" requires approval for this operation`,
        });
      } else if (policy.conditions.length > 0 && !allSupported) {
        drafts.push({
          kind: "role",
          role: policy.requiredApprovalRole,
          count: policy.requiredApprovalCount ?? 1,
          selfApprovalAllowed: false,
          reason: `organization policy "${policy.name}" could not be fully evaluated and may apply to this operation`,
        });
      }
    }
  }

  return mergeDrafts(drafts);
}
