import type { CommitResult, GatewayStatus } from "./rpc";
import type { ApprovalStatus } from "./rpc-github";

/**
 * What an AGENT is allowed to see. The dashboard shows internal reason codes,
 * semantic signals and provider detail to authorized humans; an agent gets a
 * stable, deliberately coarse contract so a compromised agent cannot use the
 * response as an oracle to tune an attack (thresholds, indicators, provider).
 */

const AGENT_REASON: Record<string, string> = {
  SEMANTIC_CRITICAL_RISK: "SECURITY_POLICY_DENIED",
  SEMANTIC_HIGH_RISK: "APPROVAL_REQUIRED_BY_POLICY",
  SEMANTIC_REQUIRED_UNAVAILABLE: "SECURITY_REVIEW_UNAVAILABLE",
  POLICY_REQUIRES_APPROVAL: "APPROVAL_REQUIRED_BY_POLICY",
  REGISTRY_REQUIRES_APPROVAL: "APPROVAL_REQUIRED_BY_POLICY",
};
/** Composition markers with no agent-visible meaning (the `degraded` flag carries it). */
const HIDDEN_REASONS = new Set(["SEMANTIC_DEGRADED_OPTIONAL"]);

const AGENT_SUMMARY: Record<string, string> = {
  TASK_NOT_EXECUTABLE: "This task has not yet received an authority contract.",
  NO_ACTIVE_CONTRACT: "No authority contract is currently active for this task.",
  CONTRACT_NOT_CURRENTLY_ACTIVE: "The task's contract has expired.",
  UNSUPPORTED_CONTRACT_VERSION: "The task's contract must be reissued.",
  FORBIDDEN_RESOURCE: "The request touches a resource that is not permitted.",
  FORBIDDEN_OPERATION: "This operation is not permitted.",
  TOOL_NOT_IN_CONTRACT: "This tool is not part of the task's authorized action set.",
  ARGUMENTS_UNDERSPECIFIED: "One or more required arguments are missing.",
  CONSTRAINT_VIOLATION: "The arguments fall outside what this task authorizes.",
  INVOCATION_LIMIT_REACHED: "The invocation budget for this task or action is exhausted.",
  WITHIN_CONTRACT: "Permitted.",
  SECURITY_POLICY_DENIED: "The request was refused by security policy.",
  APPROVAL_REQUIRED_BY_POLICY: "This request requires review before it can proceed.",
  SECURITY_REVIEW_UNAVAILABLE: "A required security review could not be completed; the request was refused.",
  APPROVAL_GRANTED: "Permitted after human approval.",
};

/** Tools executed by a real connector (mirrors gateway.is_connector_tool). */
export const CONNECTOR_TOOLS: ReadonlySet<string> = new Set([
  "github.get_issue",
  "github.read_repository",
  "github.create_branch",
  "github.put_file",
  "github.create_pull_request",
  "github.get_pull_request",
]);

export function agentReasonCodes(internal: readonly string[]): string[] {
  return internal.filter((c) => !HIDDEN_REASONS.has(c)).map((c) => AGENT_REASON[c] ?? c);
}

export function agentSummary(codes: readonly string[]): string {
  const first = codes[0];
  return (first && AGENT_SUMMARY[first]) || "No reason was recorded for this decision.";
}

export interface AgentAuthorizeResponse {
  decisionId: string;
  status: string;
  reasonCodes: string[];
  summary: string;
  contract: { id: string; version: number | null } | null;
  remainingInvocations: number | null;
  requiresApproval: boolean;
  requiresClarification: boolean;
  requiresReplan: boolean;
  wasReplayed: boolean;
  enforcement: { mode: "off" | "shadow" | "enforce"; degraded: boolean; narrowedBySecurityPolicy: boolean };
  capability: null | {
    id: string;
    /** Present only in the response that issued the capability. */
    token: string | null;
    tokenAlreadyIssued: boolean;
    tool: string;
    operation: string;
    expiresAt: string;
    maxUses: number;
  };
  /** Present while a human decision is pending or after it resolved. */
  approval: null | {
    id: string;
    state: string;
    requiredApprovals: number | null;
    approvals: number | null;
    expiresAt: string | null;
    statusUrl: string;
  };
  /** True only for tools no connector executes (Part 6 behavior). */
  simulation: boolean;
}

export function toAgentResponse(input: {
  commit: CommitResult;
  capabilityToken: string | null;
  tool: string;
  operation: string;
  approval?: ApprovalStatus | null;
}): AgentAuthorizeResponse {
  const { commit } = input;
  const final = commit.finalOutcome ?? "deny";
  const codes = agentReasonCodes(commit.reasonCodes);
  return {
    decisionId: commit.decisionId ?? "",
    status: final,
    reasonCodes: codes,
    summary: agentSummary(codes),
    contract: commit.contractId ? { id: commit.contractId, version: commit.contractVersion } : null,
    remainingInvocations: commit.remainingInvocations,
    requiresApproval: final === "require_approval",
    requiresClarification: final === "clarify",
    requiresReplan: final === "replan",
    wasReplayed: commit.replayed,
    enforcement: {
      mode: commit.semanticMode,
      degraded: commit.degraded,
      narrowedBySecurityPolicy: commit.narrowed,
    },
    capability:
      commit.capabilityId && commit.capabilityExpiresAt && commit.capabilityMaxUses
        ? {
            id: commit.capabilityId,
            token: input.capabilityToken,
            tokenAlreadyIssued: input.capabilityToken === null,
            tool: input.tool,
            operation: input.operation,
            expiresAt: commit.capabilityExpiresAt,
            maxUses: commit.capabilityMaxUses,
          }
        : null,
    approval:
      input.approval && input.approval.approvalId
        ? {
            id: input.approval.approvalId,
            state: input.approval.state ?? "pending",
            requiredApprovals: input.approval.required,
            approvals: input.approval.approved,
            expiresAt: input.approval.expiresAt,
            statusUrl: `/api/v1/approvals/${input.approval.approvalId}`,
          }
        : null,
    simulation: !CONNECTOR_TOOLS.has(input.tool),
  };
}

/** Stable HTTP contract for gateway-level failures. */
export interface FailureContract {
  http: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export function failureContract(status: Exclude<GatewayStatus, "ok">): FailureContract {
  switch (status) {
    case "invalid_credential":
    case "revoked_credential":
      // One answer for both: a caller cannot tell an unknown key from a revoked one.
      return {
        http: 401,
        code: "UNAUTHENTICATED",
        message: "The runtime key is missing, invalid or revoked.",
      };
    case "rate_limited":
      return {
        http: 429,
        code: "RATE_LIMITED",
        message: "Too many failed attempts; retry later.",
        retryAfterSeconds: 60,
      };
    case "task_not_found":
      return { http: 404, code: "TASK_NOT_FOUND", message: "Task not found." };
    case "agent_mismatch":
      return {
        http: 403,
        code: "AGENT_TASK_MISMATCH",
        message: "This key is not bound to this task's agent.",
      };
    case "idempotency_conflict":
      return {
        http: 409,
        code: "IDEMPOTENCY_CONFLICT",
        message: "This idempotency key was already used with different content.",
      };
  }
}
