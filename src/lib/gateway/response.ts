import type { CommitResult, GatewayStatus } from "./rpc";
import { agentGuidance, type AgentGuidance } from "./guidance";
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
  /** What to do next after this decision (deliberately coarse; see guidance.ts). */
  guidance: AgentGuidance;
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
    guidance: agentGuidance(final, codes),
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
    case "no_active_contract":
      return {
        http: 409,
        code: "NO_ACTIVE_CONTRACT",
        message: "This task has no currently active contract.",
      };
    case "session_task_mismatch":
      return {
        http: 403,
        code: "AGENT_TASK_MISMATCH",
        message: "This session was issued for a different task.",
      };
    case "session_contract_stale":
      return {
        http: 409,
        code: "SESSION_CONTRACT_STALE",
        message:
          "The task's active contract has changed since this session was created. Create a new session.",
      };
    case "session_revoked":
    case "session_expired":
      // Same anti-enumeration answer as an invalid/revoked runtime key: a caller cannot tell which applies.
      return {
        http: 401,
        code: "UNAUTHENTICATED",
        message: "The session token is missing, invalid, expired or revoked.",
      };
  }
}

/**
 * The developer API's own failure contract. Unlike failureContract() above,
 * this is not an exhaustive switch over a closed union -- every developer-API
 * RPC (gateway.resolve_backend_credential and everything layered on it)
 * returns a plain string status, the same deliberate choice already made for
 * reserve_connector_execution's reasonCode (see rpc-connectors.ts). New RPCs
 * can add new statuses without this function needing to stay exhaustive;
 * anything unrecognized falls through to a generic 400 rather than ever
 * defaulting to success or leaking an internal detail.
 */
export function developerApiFailureContract(status: string): FailureContract {
  switch (status) {
    case "malformed":
    case "not_found":
    case "revoked":
      // Same anti-enumeration answer as an agent runtime key: a caller cannot
      // tell a malformed secret from an unknown or revoked one.
      return {
        http: 401,
        code: "UNAUTHENTICATED",
        message: "The backend credential is missing, invalid or revoked.",
      };
    case "customer_not_found":
      return { http: 404, code: "CUSTOMER_NOT_FOUND", message: "Customer not found for this application." };
    case "agent_not_found":
      return { http: 404, code: "AGENT_NOT_FOUND", message: "Agent not found for this tenant." };
    case "connection_not_found":
    case "session_not_found":
    case "broker_not_found":
    case "not_found":
      return { http: 404, code: "NOT_FOUND", message: "The requested resource was not found." };
    case "invalid_broker_connection_ref":
    case "invalid_verified_account_ref":
      return { http: 400, code: "INVALID_REQUEST", message: "Request failed validation." };
    case "connection_not_usable_by_customer":
      return {
        http: 403,
        code: "CONNECTION_NOT_USABLE_BY_CUSTOMER",
        message: "This connection does not belong to, and is not delegated to, this customer.",
      };
    case "already_bound_to_different_connection":
      return {
        http: 409,
        code: "ALREADY_BOUND_TO_DIFFERENT_CONNECTION",
        message: "This task is already bound to a different connection for this connector.",
      };
    case "return_url_not_allowed":
      return {
        http: 400,
        code: "RETURN_URL_NOT_ALLOWED",
        message: "This return URL is not registered for this application.",
      };
    case "invalid_external_id":
    case "invalid_metadata":
    case "invalid_intent":
    case "invalid_connector_bindings":
    case "task_not_customer_scoped":
    case "task_not_found":
      return { http: 400, code: "INVALID_REQUEST", message: "Request failed validation." };
    default:
      return { http: 400, code: "INVALID_REQUEST", message: "The request could not be completed." };
  }
}
