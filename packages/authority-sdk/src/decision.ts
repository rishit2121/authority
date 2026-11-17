import type { ActionAlignment, AgentAuthorizeResponse } from "./types.js";

/**
 * What an authorize response means for the caller, in the order the checks must be applied. Shared by
 * `AuthorityAgentClient.tools.execute` and `AuthorityTask.call` so both read a decision identically.
 */
export type DecisionOutcome =
  /** A capability was issued: execute with exactly the authorized arguments. */
  | { kind: "allowed"; capabilityToken: string }
  | { kind: "requires_replan"; alignment?: ActionAlignment }
  | { kind: "held_for_review"; alignment: ActionAlignment }
  | { kind: "requires_approval"; approvalId: string; statusUrl: string }
  | { kind: "requires_clarification" }
  /**
   * The capability for this idempotency key was already issued by an earlier authorize call, so its token is not
   * returned again. The earlier call may already have executed.
   */
  | { kind: "already_authorized" }
  | { kind: "denied" };

export function classifyDecision(decision: AgentAuthorizeResponse): DecisionOutcome {
  if (decision.alignment) {
    return decision.alignment.outcome === "misaligned"
      ? { kind: "requires_replan", alignment: decision.alignment }
      : { kind: "held_for_review", alignment: decision.alignment };
  }
  if (decision.requiresApproval && decision.approval) {
    return {
      kind: "requires_approval",
      approvalId: decision.approval.id,
      statusUrl: decision.approval.statusUrl,
    };
  }
  if (decision.requiresClarification) return { kind: "requires_clarification" };
  if (decision.requiresReplan) return { kind: "requires_replan" };
  if (decision.capability?.token) return { kind: "allowed", capabilityToken: decision.capability.token };
  if (decision.capability?.tokenAlreadyIssued) return { kind: "already_authorized" };
  return { kind: "denied" };
}

/** "slack.list_channels" -> "list_channels": the operation is the tool name's action part unless given. */
export function operationOf(tool: string, operation?: string): string {
  return operation ?? tool.slice(tool.indexOf(".") + 1);
}

/** `github.*` still runs through its own route; every other connector uses the generic one. */
export function executePathFor(tool: string): string {
  return tool.startsWith("github.") ? "/api/v1/github/execute" : "/api/v1/execute";
}
