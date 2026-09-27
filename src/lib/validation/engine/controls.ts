import type { Control, StepActual } from "../schema";

const CONTRACT = new Set([
  "TOOL_NOT_IN_CONTRACT",
  "NO_ACTIVE_CONTRACT",
  "TASK_NOT_EXECUTABLE",
  "CONTRACT_NOT_CURRENTLY_ACTIVE",
  "UNSUPPORTED_CONTRACT_VERSION",
]);
const CONSTRAINTS = new Set(["CONSTRAINT_VIOLATION", "ARGUMENTS_UNDERSPECIFIED"]);
const POLICY = new Set(["FORBIDDEN_RESOURCE", "FORBIDDEN_OPERATION"]);
const CAPABILITY = new Set([
  "CAPABILITY_NOT_FOUND",
  "CAPABILITY_ALREADY_USED",
  "CAPABILITY_EXPIRED",
  "CAPABILITY_REVOKED",
  "SCOPE_MISMATCH",
  "IDEMPOTENCY_CONFLICT",
  "CONTRACT_NO_LONGER_ACTIVE",
  "TASK_NO_LONGER_EXECUTABLE",
  "AGENT_OR_KEY_REVOKED",
  "RESERVATION_IN_PROGRESS",
  "EXECUTION_IN_PROGRESS",
  "CONNECTOR_EXECUTION_REQUIRED",
]);
const BINDING = new Set([
  "REPOSITORY_NOT_BOUND",
  "REPOSITORY_NOT_ALLOWED",
  "INSTALLATION_UNAVAILABLE",
  "EXECUTION_MODE_MISMATCH",
  "REPOSITORY_MISMATCH",
]);
const GATEWAY_AUTH = new Set([
  "UNAUTHENTICATED",
  "TASK_NOT_FOUND",
  "AGENT_TASK_MISMATCH",
  "RATE_LIMITED",
  "invalid_credential",
  "revoked_credential",
  "task_not_found",
  "agent_mismatch",
  "idempotency_conflict",
]);

/**
 * Which control is responsible for what the gateway just did? Derived only from what the gateway reported (reason
 * codes / result codes), never from what the scenario hoped for.
 */
export function responsibleControl(actual: StepActual): Control {
  const codes = [...actual.reasonCodes, ...(actual.resultCode ? [actual.resultCode] : [])];
  for (const c of codes) if (GATEWAY_AUTH.has(c)) return "gateway_auth";
  for (const c of codes)
    if (c.startsWith("SEMANTIC_") || c === "SECURITY_POLICY_DENIED" || c === "SECURITY_REVIEW_UNAVAILABLE")
      return "semantic";
  for (const c of codes)
    if (
      c === "POLICY_REQUIRES_APPROVAL" ||
      c === "REGISTRY_REQUIRES_APPROVAL" ||
      c === "APPROVAL_REQUIRED_BY_POLICY"
    )
      return "approval";
  if (actual.finalDecision === "require_approval") return "approval";
  for (const c of codes) if (POLICY.has(c)) return "policy";
  for (const c of codes) if (CONSTRAINTS.has(c)) return "argument_constraints";
  for (const c of codes) if (CONTRACT.has(c)) return "contract_scope";
  for (const c of codes) if (c === "INVOCATION_LIMIT_REACHED") return "budget";
  for (const c of codes) if (CAPABILITY.has(c)) return "capability";
  for (const c of codes) if (BINDING.has(c)) return "connector_binding";
  if (actual.resultCode && actual.execution === "blocked") return "connector_guard";
  if (actual.execution === "blocked" && actual.reasonCodes.length === 0) return "connector_guard";
  return "none";
}
