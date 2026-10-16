import "server-only";

import { safeLog } from "@/lib/semantic/scrub";

import { defaultAlignmentDeps, inspectExternalContentForTask, type AlignmentDeps } from "./service";

/**
 * Screens a connector's result before it goes back to the agent -- Task
 * Shield's tool-output check, applied to content Authority itself fetched.
 *
 * Execution and inspection are separate outcomes. When the provider action
 * already happened, its receipt and status are always returned unchanged;
 * only `data` may be withheld, with `delivery: "held"`, so the agent learns
 * the action completed and is told not to repeat it. An inspection failure
 * never erases evidence or touches capability/budget accounting (both were
 * settled before this runs).
 */

const MAX_SCREENED_CHARS = 140_000;

export async function screenExecutionResult(
  input: {
    credentialSecret: string;
    taskId: string | undefined;
    tool: string;
    args: Record<string, unknown>;
    http: number;
    body: Record<string, unknown>;
  },
  deps: AlignmentDeps = defaultAlignmentDeps(),
): Promise<Record<string, unknown>> {
  if (
    input.http < 200 ||
    input.http >= 300 ||
    !input.taskId ||
    input.body.data === undefined ||
    input.body.data === null
  ) {
    return input.body;
  }
  const held = (inspection: Record<string, unknown>) => ({
    ...input.body,
    data: null,
    delivery: "held",
    inspection,
    message:
      "The action completed (see receiptId). Its result is held for review by Authority; do not repeat the action.",
  });

  let text: string;
  try {
    text = typeof input.body.data === "string" ? input.body.data : JSON.stringify(input.body.data);
  } catch {
    return held({ status: "unreviewed", reason: "unserializable" });
  }

  try {
    const result = await inspectExternalContentForTask(
      {
        secret: input.credentialSecret,
        taskId: input.taskId,
        // Oversized results are recorded as such (never "passed"); the inspector checks the real size.
        content: text.length > MAX_SCREENED_CHARS ? text.slice(0, MAX_SCREENED_CHARS + 1) : text,
        contentType: typeof input.body.data === "string" ? "text/plain" : "application/json",
        source: {
          kind: "tool_result",
          toolName: input.tool,
          toolArgs: JSON.stringify(input.args).slice(0, 2000),
        },
        origin: "connector",
        receiptId: typeof input.body.receiptId === "string" ? input.body.receiptId : null,
      },
      deps,
    );
    if (!result.ok) return held({ status: "unreviewed", reason: result.status });
    // Screening is optional: say plainly that it did not run -- never present this as a pass.
    if (result.status === "not_inspected") {
      return {
        ...input.body,
        inspection: { status: "not_inspected", ran: false, reason: result.screening.reason },
      };
    }
    const inspection = {
      inspectionId: result.inspectionId,
      status: result.status,
      ran: true,
      action: result.screening.action,
      mode: result.mode,
      policy: result.policy,
      findings: result.findings,
      feedback: result.feedback,
    };
    return result.delivered ? { ...input.body, delivery: "delivered", inspection } : held(inspection);
  } catch (error) {
    safeLog(`execution result screening failed (${error instanceof Error ? error.name : "unknown"})`);
    return held({ status: "unreviewed", reason: "inspection_error" });
  }
}
