import "server-only";

import { removeSecretMaterial } from "@/lib/semantic/redaction";
import {
  alignmentContext,
  findActionReview,
  recordActionReview,
  type AlignmentContext,
} from "@/lib/gateway/rpc-alignment";

import {
  createAlignmentReviewer,
  reviewerConfig,
  type AlignmentReviewer,
  type ReviewerUsage,
} from "./reviewer";
import { defaultAlignmentDeps, loadObjectives, type AlignmentDeps } from "./service";
import { generateFeedback, REFERENCE_EPSILON, scoreToolCall } from "./task-shield";
import type {
  AlignmentFinding,
  AlignmentPolicy,
  InstructionScore,
  ReviewOutcome,
  TaskObjectives,
} from "./types";
import { clip } from "./types";
import { checkCallValues, extractRequestLiterals } from "./values";

/**
 * Task Shield's action-checking hook (§4.2: tool calls are checked before they
 * execute; misaligned calls are not executed), run inside Authority's
 * authorization, after authentication and the deterministic contract check
 * and before the atomic commit.
 *
 * A review can only stop or hold a call. It never runs for a call the
 * deterministic check already refused, and when it clears a call the commit
 * still re-runs every deterministic check and re-verifies, under the task's
 * lock, that this review is for exactly these arguments and versions.
 */

export type ActionCheck =
  | { kind: "off" }
  /** Record a review after the decision; never changes it. */
  | { kind: "shadow"; after: () => Promise<void> }
  | { kind: "clear"; reviewId: string; covered: boolean }
  | {
      kind: "block";
      outcome: Exclude<ReviewOutcome, "aligned">;
      reviewId: string | null;
      policy: AlignmentPolicy;
      findings: AlignmentFinding[];
      feedback: string | null;
    }
  | { kind: "failure"; status: "session_required" };

export interface ActionInput {
  credentialSecret: string;
  taskId: string;
  tool: string;
  operation: string;
  resource: string | null;
  args: Record<string, unknown>;
  idempotencyKey: string;
  /** The deterministic pre-evaluation from prepare_authorization. */
  detOutcome: string | null;
}

export interface ActionCheckDeps extends AlignmentDeps {
  findAction: typeof findActionReview;
  recordAction: typeof recordActionReview;
}

let cachedReviewer: AlignmentReviewer | null | undefined;
export function defaultActionCheckDeps(): ActionCheckDeps {
  if (cachedReviewer === undefined) cachedReviewer = createAlignmentReviewer();
  return {
    ...defaultAlignmentDeps(),
    reviewer: cachedReviewer,
    context: alignmentContext,
    findAction: findActionReview,
    recordAction: recordActionReview,
  };
}

interface ContractAction {
  tool: string;
  constraints?: { key: string; equals: unknown }[];
}

/** Argument keys whose value is pinned, verbatim, by a matching action in the active contract. */
export function pinnedKeys(
  allowedActions: unknown,
  tool: string,
  args: Record<string, unknown>,
): Set<string> {
  const items = ((allowedActions as { items?: ContractAction[] } | null)?.items ?? []).filter(
    (a) => a.tool === tool,
  );
  for (const action of items) {
    const constraints = action.constraints ?? [];
    const keys = new Set<string>();
    let matches = true;
    for (const c of constraints) {
      if (!(c.key in args) || String(args[c.key]) !== String(c.equals)) {
        matches = false;
        break;
      }
      keys.add(c.key);
    }
    if (matches) return keys;
  }
  return new Set();
}

function planCleared(ctx: AlignmentContext): boolean {
  return (
    ctx.planDecision !== "rejected" && (ctx.planOutcome === "aligned" || ctx.planDecision === "approved")
  );
}

interface Reviewed {
  outcome: ReviewOutcome;
  findings: AlignmentFinding[];
  scores: InstructionScore[];
  feedback: string | null;
  usage: ReviewerUsage | null;
  covered: boolean;
}

async function review(
  input: ActionInput,
  ctx: AlignmentContext,
  objectives: TaskObjectives,
  deps: ActionCheckDeps,
): Promise<Reviewed> {
  const pinned = pinnedKeys(ctx.allowedActions, input.tool, input.args);
  const unpinned = Object.keys(input.args).filter((k) => !pinned.has(k));

  // Production: only explicit conflicts with values in the request are decided deterministically here; an
  // undetermined value may legitimately come from an earlier step's output, so it goes to the reviewer.
  const deterministic =
    ctx.policy === "production"
      ? checkCallValues(
          { tool: input.tool, args: input.args },
          extractRequestLiterals(objectives.requestText),
        ).filter((f) => f.severity === "conflict")
      : [];

  // Production: every value pinned by a contract whose plan review cleared was already checked at prepare.
  if (
    ctx.policy === "production" &&
    deterministic.length === 0 &&
    unpinned.length === 0 &&
    planCleared(ctx)
  ) {
    return { outcome: "aligned", findings: [], scores: [], feedback: null, usage: null, covered: true };
  }
  if (!deps.reviewer) {
    return {
      outcome: deterministic.length ? "misaligned" : "unreviewed",
      findings: [
        ...deterministic,
        {
          type: "reviewer_unavailable",
          source: "task_shield",
          severity: "unreviewed",
          explanation: "No reviewer is configured.",
        },
      ],
      scores: [],
      feedback: null,
      usage: null,
      covered: false,
    };
  }

  const related = [
    `Authorized by the task's contract${pinned.size ? ` with pinned values for: ${[...pinned].join(", ")}` : ""}.`,
    unpinned.length ? `Values chosen at run time (not fixed by the plan): ${unpinned.join(", ")}.` : "",
    ctx.policy === "production" && objectives.prohibitions.length
      ? `The user forbids: ${objectives.prohibitions.join("; ")}.`
      : "",
    ctx.policy === "production" ? `The user's original request: "${clip(objectives.requestText, 1500)}"` : "",
    `Content Authority has inspected for this task so far: revision ${ctx.contextRevision}.`,
  ]
    .filter(Boolean)
    .join("\n");
  const scored = await scoreToolCall(deps.reviewer, {
    toolName: input.tool,
    toolArgs: removeSecretMaterial(JSON.stringify(input.args)).text,
    relatedContent: related,
    taskInstructions: objectives.taskInstructions,
    epsilon: REFERENCE_EPSILON,
  });
  if (!scored.ok) {
    return {
      outcome: deterministic.length ? "misaligned" : "unreviewed",
      findings: [
        ...deterministic,
        {
          type: "reviewer_unavailable",
          source: "task_shield",
          severity: "unreviewed",
          explanation: `Review did not complete (${scored.reason}).`,
        },
      ],
      scores: [],
      feedback: null,
      usage: scored.usage,
      covered: false,
    };
  }
  const zero: AlignmentFinding[] = scored.value.misaligned
    ? [
        {
          type: "misaligned_instruction",
          source: "task_shield",
          severity: "conflict",
          value: clip(scored.value.instruction, 300),
          explanation: `This call contributes ${scored.value.total.toFixed(2)} to the user's request.`,
        },
      ]
    : [];
  const findings = [...deterministic, ...zero];
  const misaligned = findings.some((f) => f.severity === "conflict");
  return {
    outcome: misaligned ? "misaligned" : "aligned",
    findings,
    scores: [scored.value],
    feedback: misaligned
      ? generateFeedback({
          misalignedInstructions: [scored.value.instruction],
          userInstructions: objectives.taskInstructions,
        })
      : null,
    usage: scored.usage,
    covered: false,
  };
}

export async function checkAction(
  input: ActionInput,
  deps: ActionCheckDeps = defaultActionCheckDeps(),
): Promise<ActionCheck> {
  const ctx = await deps.context(input.credentialSecret, input.taskId);
  if (ctx.status !== "ok" || ctx.mode === "off" || !ctx.checkActions) return { kind: "off" };
  // Task isolation is not decided here: applications.require_task_sessions is enforced before this runs, and no
  // alignment, review or screening setting can turn it on or off.
  // A deterministic denial stands on its own; the reviewer is never asked to second-guess it.
  if (input.detOutcome !== "allow" && input.detOutcome !== "allow_constrained") return { kind: "off" };

  const run = async (): Promise<ActionCheck> => {
    const fresh = await deps.context(input.credentialSecret, input.taskId);
    const loaded = await loadObjectives(input.credentialSecret, input.taskId, fresh, deps);
    const c = loaded.context;
    const objectiveVersion = loaded.ok ? loaded.objectives.version : c.objectiveVersion;

    if (loaded.ok) {
      const existing = await deps.findAction({
        secret: input.credentialSecret,
        taskId: input.taskId,
        tool: input.tool,
        operation: input.operation,
        resource: input.resource,
        args: input.args,
        idempotencyKey: input.idempotencyKey,
        objectiveVersion,
        contextRevision: c.contextRevision,
      });
      if (existing.status === "ok" && existing.reviewId && existing.outcome && existing.mode === c.mode) {
        const cleared =
          existing.decision !== "rejected" &&
          (existing.outcome === "aligned" || existing.decision === "approved");
        if (cleared) return { kind: "clear", reviewId: existing.reviewId, covered: false };
        return {
          kind: "block",
          outcome:
            existing.decision === "rejected"
              ? "misaligned"
              : (existing.outcome as Exclude<ReviewOutcome, "aligned">),
          reviewId: existing.reviewId,
          policy: existing.policy ?? c.policy,
          findings: (existing.findings as AlignmentFinding[]) ?? [],
          feedback: existing.feedback,
        };
      }
    }

    const result: Reviewed = loaded.ok
      ? await review(input, c, loaded.objectives, deps)
      : {
          outcome: "unreviewed",
          findings: [
            {
              type: "reviewer_unavailable",
              source: "task_shield",
              severity: "unreviewed",
              explanation: `The user's objectives could not be established (${loaded.reason}).`,
            },
          ],
          scores: [],
          feedback: null,
          usage: loaded.usage,
          covered: false,
        };

    let reviewId: string | null = null;
    if (objectiveVersion > 0) {
      const recorded = await deps.recordAction({
        secret: input.credentialSecret,
        taskId: input.taskId,
        tool: input.tool,
        operation: input.operation,
        resource: input.resource,
        args: input.args,
        idempotencyKey: input.idempotencyKey,
        mode: c.mode as "shadow" | "enforce",
        policy: c.policy,
        objectiveVersion,
        contextRevision: c.contextRevision,
        contractId: c.contractId,
        outcome: result.outcome,
        findings: result.findings,
        scores: result.scores,
        feedback: result.feedback,
        reviewer: deps.reviewer
          ? { ...reviewerConfig(deps.reviewer.model), policy: c.policy }
          : { policy: c.policy },
        usage: { ...(result.usage ?? { calls: 0 }), coveredByPlanReview: result.covered },
      });
      reviewId = recorded.status === "ok" ? recorded.reviewId : null;
    }
    if (result.outcome === "aligned" && reviewId) return { kind: "clear", reviewId, covered: result.covered };
    return {
      kind: "block",
      outcome: result.outcome === "aligned" ? "unreviewed" : result.outcome,
      reviewId,
      policy: c.policy,
      findings: result.findings,
      feedback: result.feedback,
    };
  };

  if (ctx.mode === "shadow") {
    return {
      kind: "shadow",
      after: async () => {
        await run();
      },
    };
  }
  return run();
}
