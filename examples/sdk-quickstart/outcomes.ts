import type { PrepareTaskResult, TaskCallResult } from "@authority/sdk";

/** One readable line per prepare outcome. Prints ids and paths only -- never a key or token. */
export function describePrepare(run: PrepareTaskResult, baseUrl: string): string {
  switch (run.status) {
    case "ready":
      return `Ready: task ${run.taskId}, contract ${run.contractId} v${run.version} (budgets ${run.budgets}). Tools: ${run.tools.join(", ")}`;
    case "partial":
      return (
        `Partially accepted: ${run.excludedSteps.map((s) => `${s.tool} (${s.status}: ${s.reasons.join("; ")})`).join(", ")} ` +
        `left out. No session opened. Fix the actions, or accept the narrower contract with authority.openTask("${run.taskId}").`
      );
    case "awaiting_approval":
      return `Awaiting approval: a person must activate it at ${new URL(run.approvalPath, baseUrl)}. Then call authority.openTask("${run.taskId}").`;
    case "alignment_review":
      return `Alignment review (${run.decision}): see ${new URL(run.reviewPath, baseUrl)}.${run.alignment.feedback ? ` ${run.alignment.feedback}` : ""}`;
    case "clarification":
      return `Needs clarification: ${run.reason}`;
    case "rejected":
      return `Rejected: ${run.reason}`;
    case "ai_unavailable":
      return "Plan review is unavailable right now. Try again later.";
  }
}

/** One readable line per call outcome. */
export function describeCall(result: TaskCallResult): string {
  const why = result.summary ? ` -- ${result.summary}` : "";
  switch (result.status) {
    case "executed":
      return `Executed. Receipt ${result.receiptId ?? "(none)"}.`;
    case "result_held":
      return `Done, but the result is held for review (receipt ${result.receiptId ?? "(none)"}). Do not repeat it.`;
    case "denied":
      return `Denied (${result.reasonCodes.join(", ")})${why}`;
    case "requires_approval":
      return `Needs approval (${result.approvalId}). Repeat the call with the same idempotencyKey once approved.`;
    case "requires_clarification":
      return `Needs clarification${why}`;
    case "requires_replan":
      return `Needs a new plan${why}`;
    case "held_for_review":
      return `Held for review by task alignment. Repeat with the same idempotencyKey once approved.`;
    case "already_authorized":
      return "This idempotencyKey was already used; the earlier call may have run. Not repeated.";
    case "execution_failed":
      return `Did not run (${result.code}). Nothing was written.`;
    case "indeterminate":
      return `Outcome unknown (${result.cause}): the post MAY have happened. Not retried -- check Slack first.`;
    case "in_progress":
      return "Already running under this idempotencyKey.";
    case "session_expired":
      return `Session ${result.cause}. Open a new handle with authority.openTask(taskId).`;
    case "stale_session":
      return `The contract changed (${result.code}). Open a new handle; nothing was re-prepared.`;
    case "cancelled":
      return `Cancelled ${result.stage.replace(/_/g, " ")} (${result.cause}). Nothing was written.`;
  }
}
