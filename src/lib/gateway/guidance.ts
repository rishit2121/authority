/**
 * What an agent should do NEXT after a refusal. Deliberately coarse: it names the recovery action, never the
 * threshold, indicator, provider or policy text that caused the refusal, so it cannot be used as an oracle to tune
 * an attack. It only ever advises asking for, or waiting on, MORE human-granted authority — never taking any.
 */
export type NextStep = "proceed" | "replan" | "clarify" | "request_approval" | "retry_later" | "stop";

export interface AgentGuidance {
  nextStep: NextStep;
  message: string;
}

const HARD_STOP = new Set([
  "FORBIDDEN_RESOURCE",
  "FORBIDDEN_OPERATION",
  "SECURITY_POLICY_DENIED",
  "INVOCATION_LIMIT_REACHED",
]);
const NEEDS_NEW_CONTRACT = new Set([
  "NO_ACTIVE_CONTRACT",
  "TASK_NOT_EXECUTABLE",
  "CONTRACT_NOT_CURRENTLY_ACTIVE",
  "UNSUPPORTED_CONTRACT_VERSION",
]);

export function agentGuidance(
  finalOutcome: string | null | undefined,
  reasonCodes: readonly string[],
): AgentGuidance {
  const has = (c: string) => reasonCodes.includes(c);
  const any = (s: Set<string>) => reasonCodes.some((c) => s.has(c));

  if (finalOutcome === "allow" || finalOutcome === "allow_constrained") {
    return {
      nextStep: "proceed",
      message:
        "Permitted. Execute with the issued capability and exactly the arguments you were authorized for.",
    };
  }
  if (finalOutcome === "require_approval" || has("APPROVAL_REQUIRED_BY_POLICY")) {
    return {
      nextStep: "request_approval",
      message:
        "A human must approve this request. Poll the approval status URL; when approved, call authorize again with the same idempotency key and arguments to receive the capability.",
    };
  }
  if (has("SECURITY_REVIEW_UNAVAILABLE")) {
    return {
      nextStep: "retry_later",
      message:
        "A required security review could not complete. Retry the same request later; do not change it to avoid the review.",
    };
  }
  if (any(NEEDS_NEW_CONTRACT)) {
    return {
      nextStep: "stop",
      message:
        "This task has no usable authority contract. Ask the task owner to issue or renew one; do not retry.",
    };
  }
  if (any(HARD_STOP)) {
    return {
      nextStep: "stop",
      message:
        "This request is refused by policy or budget. Do not retry or rephrase it; report the refusal to the user.",
    };
  }
  if (finalOutcome === "clarify" || has("ARGUMENTS_UNDERSPECIFIED")) {
    return {
      nextStep: "clarify",
      message:
        "Required information is missing. Ask the user for it and send a new request with the complete arguments.",
    };
  }
  if (finalOutcome === "replan" || has("TOOL_NOT_IN_CONTRACT")) {
    return {
      nextStep: "replan",
      message:
        "This operation is not part of the task's authorized plan. Replan using only authorized operations, or ask the user to extend the task.",
    };
  }
  if (has("CONSTRAINT_VIOLATION")) {
    return {
      nextStep: "replan",
      message:
        "The arguments fall outside what this task authorizes. Use exactly the values the user specified, or ask the user to confirm a change.",
    };
  }
  return {
    nextStep: "stop",
    message: "The request was refused. Do not retry it unchanged; report the refusal to the user.",
  };
}
