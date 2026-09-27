/**
 * Human-readable summaries for authorize_tool_call()'s machine reason
 * codes, kept next to the runtime layer the same way
 * `lib/authorization/decision-status.ts` keeps status presentation next to
 * the evaluator — one place a dashboard, a CLI or an agent's own error
 * message can all pull an identical human sentence from.
 */
const REASON_SUMMARIES: Record<string, string> = {
  TASK_NOT_EXECUTABLE: "This task has not yet received an authority contract.",
  NO_ACTIVE_CONTRACT: "No authority contract is currently active for this task.",
  CONTRACT_NOT_CURRENTLY_ACTIVE: "The task's contract has expired and is awaiting reconciliation.",
  UNSUPPORTED_CONTRACT_VERSION:
    "The task's contract was compiled against a registry or compiler version that is no longer supported.",
  FORBIDDEN_RESOURCE: "The request touches a resource an active policy forbids outright.",
  FORBIDDEN_OPERATION: "This exact operation is denied by an active policy.",
  TOOL_NOT_IN_CONTRACT: "This tool is not part of the task's authorized action set.",
  ARGUMENTS_UNDERSPECIFIED: "One or more required arguments are missing.",
  CONSTRAINT_VIOLATION: "The arguments fall outside the contract's constraints for this action.",
  INVOCATION_LIMIT_REACHED: "The invocation budget for this task or action has been exhausted.",
  SEMANTIC_CRITICAL_RISK: "Semantic enforcement narrowed this allow to a deny (critical risk).",
  SEMANTIC_HIGH_RISK: "Semantic enforcement narrowed this allow to require approval (high risk).",
  SEMANTIC_REQUIRED_UNAVAILABLE:
    "A required semantic evaluation was unavailable, so the request failed closed.",
  SEMANTIC_DEGRADED_OPTIONAL:
    "The optional semantic evaluation was degraded; the deterministic result was kept.",
  POLICY_REQUIRES_APPROVAL: "Tenant policy requires a human approval for this risk class.",
  REGISTRY_REQUIRES_APPROVAL: "The registry marks this operation as requiring approval.",
  APPROVAL_GRANTED: "Permitted after human approval.",
  WITHIN_CONTRACT: "Permitted; the request satisfies every contract constraint.",
};

export function summarizeReasonCodes(codes: readonly string[]): string {
  const [first] = codes;
  if (!first) return "No reason was recorded for this decision.";
  return REASON_SUMMARIES[first] ?? first;
}
