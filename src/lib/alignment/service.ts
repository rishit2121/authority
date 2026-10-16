import "server-only";

import type { CandidatePlan } from "@/lib/domain";
import {
  alignmentContext,
  findAlignmentReview,
  recordAlignmentReview,
  recordExternalContent,
  recordTaskObjectives,
  type AlignmentContext,
} from "@/lib/gateway/rpc-alignment";
import type { LoadedRegistry } from "@/lib/registry";

import { hashContent, inspectContent, type ContentSource } from "./content-inspection";
import { extractObjectives, objectivesFromStored } from "./objectives";
import { reviewPlan, type PlanStep } from "./plan-review";
import {
  createAlignmentReviewer,
  reviewerConfig,
  type AlignmentReviewer,
  type ReviewerFailure,
  type ReviewerUsage,
} from "./reviewer";
import type {
  AlignmentFinding,
  AlignmentPolicy,
  ContentStatus,
  ReviewOutcome,
  TaskObjectives,
} from "./types";

/**
 * Orchestration of task alignment for the HTTP routes and prepare(): reads the
 * task's server-side alignment context, loads (or once extracts) objectives,
 * runs a review, and records the result bound to its exact subject and
 * versions. Nothing a caller asserts about trust is used; only the
 * authenticated credential decides which task this touches.
 */

export interface AlignmentDeps {
  reviewer: AlignmentReviewer | null;
  context: typeof alignmentContext;
  recordObjectives: typeof recordTaskObjectives;
  recordReview: typeof recordAlignmentReview;
  findReview: typeof findAlignmentReview;
  recordContent: typeof recordExternalContent;
}

let cachedReviewer: AlignmentReviewer | null | undefined;
export function defaultAlignmentDeps(): AlignmentDeps {
  if (cachedReviewer === undefined) cachedReviewer = createAlignmentReviewer();
  return {
    reviewer: cachedReviewer,
    context: alignmentContext,
    recordObjectives: recordTaskObjectives,
    recordReview: recordAlignmentReview,
    findReview: findAlignmentReview,
    recordContent: recordExternalContent,
  };
}

function reviewerMeta(deps: AlignmentDeps, policy: AlignmentPolicy) {
  return deps.reviewer ? { ...reviewerConfig(deps.reviewer.model), policy } : { model: null, policy };
}

export type ObjectivesResult =
  | { ok: true; objectives: TaskObjectives; context: AlignmentContext; usage: ReviewerUsage | null }
  | { ok: false; reason: ReviewerFailure | "stale"; context: AlignmentContext; usage: ReviewerUsage | null };

/** The task's current objectives; on first use, extracted from the task's own stored request and recorded as version 1. */
export async function loadObjectives(
  secret: string,
  taskId: string,
  context: AlignmentContext,
  deps: AlignmentDeps,
): Promise<ObjectivesResult> {
  if (context.objectiveVersion > 0) {
    const objectives = objectivesFromStored(
      context.objectiveVersion,
      context.objectiveRequest ?? context.taskIntent ?? "",
      context.objectiveExtraction,
    );
    return objectives
      ? { ok: true, objectives, context, usage: null }
      : { ok: false, reason: "malformed", context, usage: null };
  }
  const requestText = context.taskIntent ?? "";
  if (!deps.reviewer || !requestText) return { ok: false, reason: "unavailable", context, usage: null };

  const extracted = await extractObjectives(deps.reviewer, requestText, context.policy);
  if (!extracted.ok) return { ok: false, reason: extracted.reason, context, usage: extracted.usage };
  const recorded = await deps.recordObjectives({
    secret,
    taskId,
    source: "original_request",
    requestText,
    extraction: extracted.extraction,
    status: "extracted",
    reviewer: { ...reviewerMeta(deps, context.policy), usage: extracted.usage },
    expectedVersion: 0,
  });
  if (recorded.status === "stale") {
    // Another request recorded them first: use those, never ours.
    const fresh = await deps.context(secret, taskId);
    const objectives = objectivesFromStored(
      fresh.objectiveVersion,
      fresh.objectiveRequest ?? "",
      fresh.objectiveExtraction,
    );
    return objectives
      ? { ok: true, objectives, context: fresh, usage: extracted.usage }
      : { ok: false, reason: "stale", context: fresh, usage: extracted.usage };
  }
  if (recorded.status !== "ok" || !recorded.version)
    return { ok: false, reason: "error", context, usage: extracted.usage };
  return {
    ok: true,
    objectives: { version: recorded.version, requestText, ...extracted.extraction },
    context: { ...context, objectiveVersion: recorded.version },
    usage: extracted.usage,
  };
}

// ---------------------------------------------------------------------------
// Objectives revision (authenticated application updates only).
// ---------------------------------------------------------------------------

export type ReviseObjectivesResult =
  { ok: true; version: number; objectives: TaskObjectives } | { ok: false; status: string };

export async function reviseObjectives(
  secret: string,
  taskId: string,
  requestText: string,
  deps = defaultAlignmentDeps(),
): Promise<ReviseObjectivesResult> {
  const context = await deps.context(secret, taskId);
  if (context.status !== "ok") return { ok: false, status: context.status };
  if (context.credentialKind !== "backend") return { ok: false, status: "backend_key_required" };
  if (context.mode === "off") return { ok: false, status: "alignment_disabled" };
  if (!deps.reviewer) return { ok: false, status: "reviewer_unavailable" };
  const extracted = await extractObjectives(deps.reviewer, requestText, context.policy);
  if (!extracted.ok) return { ok: false, status: "reviewer_unavailable" };
  const recorded = await deps.recordObjectives({
    secret,
    taskId,
    source: "application_update",
    requestText,
    extraction: extracted.extraction,
    status: "extracted",
    reviewer: { ...reviewerMeta(deps, context.policy), usage: extracted.usage },
    expectedVersion: context.objectiveVersion,
  });
  if (recorded.status !== "ok" || !recorded.version) return { ok: false, status: recorded.status };
  return {
    ok: true,
    version: recorded.version,
    objectives: { version: recorded.version, requestText, ...extracted.extraction },
  };
}

// ---------------------------------------------------------------------------
// Plan review, from prepare().
// ---------------------------------------------------------------------------

export function planStepsFrom(
  plan: CandidatePlan,
  includedNodeIds: readonly string[],
  registry: LoadedRegistry,
): PlanStep[] {
  const included = new Set(includedNodeIds);
  return plan.nodes
    .filter((n) => included.has(n.id))
    .sort((a, b) => a.sequence - b.sequence)
    .map((n) => ({
      id: n.id,
      sequence: n.sequence,
      tool: n.tool,
      args: n.arguments as Record<string, unknown>,
      sideEffect: n.expectedSideEffect,
      dependencies: n.dependencies ?? [],
      derivedKeys: (n.dataFlowRefs ?? []).map((r) => r.argumentKey),
      resourceKeys: (registry.operations.get(n.tool)?.argumentFields ?? [])
        .filter((f) => f.identifiesResource)
        .map((f) => f.key),
    }));
}

export interface PlanAlignment {
  mode: "shadow" | "enforce";
  policy: AlignmentPolicy;
  outcome: ReviewOutcome;
  decision: "approved" | "rejected" | null;
  findings: AlignmentFinding[];
  feedback: string | null;
  /** Set once recorded against the persisted contract. */
  reviewId: string | null;
  /** True when the outcome lets the contract activate (enforcement only). */
  cleared: boolean;
  record: ((contractId: string) => Promise<string | null>) | null;
}

export async function reviewPlanForTask(input: {
  secret: string;
  taskId: string;
  steps: PlanStep[];
  /** The compiled plan's input hash: the exact subject this review is about. */
  subjectHash: string;
  deps?: AlignmentDeps;
}): Promise<PlanAlignment | null> {
  const deps = input.deps ?? defaultAlignmentDeps();
  const context = await deps.context(input.secret, input.taskId);
  if (context.status !== "ok" || context.mode === "off" || !context.checkPlans) return null;
  const mode = context.mode;

  const loaded = await loadObjectives(input.secret, input.taskId, context, deps);
  const ctx = loaded.context;

  if (loaded.ok) {
    // A retry of the same plan under the same objectives reuses its review, including a person's decision.
    const existing = await deps.findReview({
      secret: input.secret,
      taskId: input.taskId,
      kind: "plan",
      subjectHash: input.subjectHash,
      objectiveVersion: loaded.objectives.version,
      contextRevision: null,
    });
    if (existing.status === "ok" && existing.reviewId && existing.outcome && existing.mode === mode) {
      return {
        mode,
        policy: existing.policy ?? ctx.policy,
        outcome: existing.outcome,
        decision: existing.decision,
        findings: (existing.findings as AlignmentFinding[]) ?? [],
        feedback: existing.feedback,
        reviewId: existing.reviewId,
        cleared:
          existing.decision !== "rejected" &&
          (existing.outcome === "aligned" || existing.decision === "approved"),
        record: null,
      };
    }
  }

  const review = loaded.ok
    ? await reviewPlan({
        reviewer: deps.reviewer,
        policy: ctx.policy,
        objectives: loaded.objectives,
        steps: input.steps,
      })
    : {
        outcome: "unreviewed" as const,
        findings: [
          {
            type: "reviewer_unavailable" as const,
            source: "task_shield" as const,
            severity: "unreviewed" as const,
            explanation: `The user's objectives could not be established (${loaded.reason}).`,
          },
        ],
        scores: [],
        feedback: null,
        usage: loaded.usage ?? { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
      };

  const objectiveVersion = loaded.ok ? loaded.objectives.version : 0;
  const record =
    objectiveVersion > 0
      ? async (contractId: string) => {
          const r = await deps.recordReview({
            secret: input.secret,
            taskId: input.taskId,
            kind: "plan",
            mode,
            policy: ctx.policy,
            subjectHash: input.subjectHash,
            objectiveVersion,
            contextRevision: ctx.contextRevision,
            contractId,
            idempotencyKey: null,
            outcome: review.outcome,
            findings: review.findings,
            scores: review.scores,
            feedback: review.feedback,
            reviewer: reviewerMeta(deps, ctx.policy),
            usage: review.usage,
          });
          return r.status === "ok" ? r.reviewId : null;
        }
      : null;

  return {
    mode,
    policy: ctx.policy,
    outcome: review.outcome,
    decision: null,
    findings: review.findings,
    feedback: review.feedback,
    reviewId: null,
    cleared: review.outcome === "aligned",
    record,
  };
}

// ---------------------------------------------------------------------------
// External content.
// ---------------------------------------------------------------------------

export interface ContentRequest {
  secret: string;
  taskId: string;
  content: string;
  contentType: string;
  source: ContentSource & { uri?: string };
  origin: "api" | "connector";
  receiptId?: string | null;
}

export type ContentResponse =
  | { ok: false; status: string }
  | {
      ok: true;
      inspectionId: string | null;
      status: ContentStatus | "not_inspected";
      mode: "off" | "shadow" | "enforce";
      policy: AlignmentPolicy;
      contentHash: string | null;
      contextRevision: number | null;
      findings: AlignmentFinding[];
      feedback: string | null;
      /**
       * Which check ran. `ran: false` means the content was NOT inspected (screening off or alignment off) --
       * never a pass. `action`: what screening does with findings ("report" never withholds).
       */
      screening: {
        ran: boolean;
        reason?: "alignment_off" | "content_screening_off";
        action: "report" | "quarantine" | "shadow" | "none";
      };
      /** Present only when the content may go to the model -- always as external data. */
      delivered: {
        role: "external_data";
        source: { kind: string; label: string | null; uri: string | null };
        text: string;
      } | null;
    };

const RETENTION_SECONDS = 7 * 24 * 3600;

export async function inspectExternalContentForTask(
  req: ContentRequest,
  deps = defaultAlignmentDeps(),
): Promise<ContentResponse> {
  const context = await deps.context(req.secret, req.taskId);
  if (context.status !== "ok") return { ok: false, status: context.status };
  const source = { kind: req.source.kind, label: req.source.label ?? null, uri: req.source.uri ?? null };
  if (context.mode === "off" || !context.checkContent) {
    // Screening is an optional addition: when it is off the content goes through unchanged and is reported as
    // NOT inspected. Plan and action alignment never depend on it.
    return {
      ok: true,
      inspectionId: null,
      status: "not_inspected",
      mode: context.mode,
      policy: context.policy,
      contentHash: null,
      contextRevision: null,
      findings: [],
      feedback: null,
      screening: {
        ran: false,
        reason: context.mode === "off" ? "alignment_off" : "content_screening_off",
        action: "none",
      },
      delivered: { role: "external_data", source, text: req.content },
    };
  }
  // Task isolation is decided by applications.require_task_sessions (in alignment_auth), not by these settings.

  const loaded = await loadObjectives(req.secret, req.taskId, context, deps);
  const ctx = loaded.context;
  const inspection = loaded.ok
    ? await inspectContent({
        reviewer: deps.reviewer,
        policy: ctx.policy,
        objectives: loaded.objectives,
        content: req.content,
        contentType: req.contentType,
        source: req.source,
        maxBytes: ctx.maxContentBytes,
      })
    : null;
  const action = ctx.mode === "shadow" ? ("shadow" as const) : ctx.contentAction;
  const assessed: ContentStatus = inspection?.status ?? "unreviewed";
  // Report-only (and shadow): findings are attached but nothing is withheld, so "quarantined"/"held" are
  // recorded as "flagged" -- reported, not quarantined.
  const status: ContentStatus =
    action !== "quarantine" && (assessed === "quarantined" || assessed === "held") ? "flagged" : assessed;
  const findings: AlignmentFinding[] = inspection?.findings ?? [
    {
      type: "reviewer_unavailable",
      source: "inspection",
      severity: "unreviewed",
      explanation: `The user's objectives could not be established (${loaded.ok ? "" : loaded.reason}).`,
    },
  ];
  const contentHash = inspection?.contentHash ?? hashContent(req.content);
  const byteSize = Buffer.byteLength(req.content, "utf8");

  let reviewId: string | null = null;
  if (loaded.ok && inspection) {
    const recorded = await deps.recordReview({
      secret: req.secret,
      taskId: req.taskId,
      kind: "content",
      mode: ctx.mode as "shadow" | "enforce",
      policy: ctx.policy,
      subjectHash: contentHash,
      objectiveVersion: loaded.objectives.version,
      contextRevision: ctx.contextRevision,
      contractId: null,
      idempotencyKey: null,
      outcome:
        assessed === "passed"
          ? "aligned"
          : assessed === "held"
            ? "ambiguous"
            : assessed === "unreviewed"
              ? "unreviewed"
              : "misaligned",
      findings,
      scores: inspection.scores,
      feedback: inspection.feedback,
      reviewer: reviewerMeta(deps, ctx.policy),
      usage: inspection.usage,
    });
    reviewId = recorded.reviewId;
  }

  // Quarantine delivers only content that passed; report-only and shadow never withhold (the reference policy's
  // "original output plus feedback" is report-only by definition).
  const deliver = action !== "quarantine" || status === "passed";
  const fitsRetention = byteSize <= 131072;
  const item = await deps.recordContent({
    secret: req.secret,
    taskId: req.taskId,
    reviewId,
    origin: req.origin,
    sourceKind: req.source.kind,
    sourceLabel: req.source.label?.slice(0, 200) ?? null,
    sourceUri: req.source.uri?.slice(0, 500) ?? null,
    contentType: req.contentType,
    contentHash,
    byteSize,
    status,
    receiptId: req.receiptId ?? null,
    // Raw text is kept (encrypted, bounded) only when it was withheld, for the review path.
    retainContent: !deliver && fitsRetention ? req.content : null,
    retentionSeconds: RETENTION_SECONDS,
  });

  return {
    ok: true,
    inspectionId: item.itemId,
    status,
    mode: ctx.mode,
    policy: ctx.policy,
    contentHash,
    contextRevision: item.contextRevision,
    findings,
    feedback: inspection?.feedback ?? null,
    screening: { ran: true, action },
    delivered: deliver ? { role: "external_data", source, text: req.content } : null,
  };
}
