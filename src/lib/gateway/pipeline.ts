import "server-only";

import { z } from "zod";

import { toolArgumentsSchema, type SemanticEvidence } from "@/lib/domain";
import { breakerFor, type CircuitBreaker } from "@/lib/semantic/circuit-breaker";
import { createSemanticProvider } from "@/lib/semantic/config";
import type { SemanticRiskProvider } from "@/lib/semantic/provider";
import { runSemanticEvaluation } from "@/lib/semantic/runner";
import { safeLog } from "@/lib/semantic/scrub";

import { canonicalHash } from "@/lib/authorization/canonicalize";
import { getOpenRouterEnv } from "@/lib/openrouter/env";
import { OpenRouterJevRiskProvider } from "@/lib/jev/openrouter-risk-provider";
import { jevRiskModeForTask, recordRiskEvaluation } from "@/lib/jev/risk-persistence";
import { runRiskEvaluation } from "@/lib/jev/risk-runner";
import type { RiskEvaluationInput } from "@/lib/jev/risk-provider";
import { JevProviderUnavailableError } from "@/lib/jev/types";

import { checkAction, type ActionCheck, type ActionInput } from "@/lib/alignment/action-check";
import type { AlignmentFinding, AlignmentPolicy } from "@/lib/alignment/types";

import { buildArgumentAudit, sanitizeResource, type ArgumentValue } from "./argument-audit";
import { generateCapabilityToken } from "./capability-token";
import {
  commitAuthorization,
  commitAuthorizationAligned,
  prepareAuthorization,
  taskCredentialPolicy,
  type CommitResult,
  type GatewayStatus,
} from "./rpc";
import { approvalForRequest, type ApprovalStatus } from "./rpc-github";
import { registryRequiresApproval, riskClassFor } from "./risk-class";

export const GATEWAY_VERSION = "authority-gateway-2026-09-29";

const priorCallsSchema = z.array(z.object({ tool: z.string(), arguments: toolArgumentsSchema })).max(5);

export interface AuthorizeInput {
  credentialSecret: string;
  taskId: string;
  tool: string;
  operation: string;
  resource?: string;
  arguments: Record<string, ArgumentValue>;
  planNodeId?: string;
  idempotencyKey: string;
  /** 1 (default, single-use) to 5 (explicitly bounded multi-use). */
  maxUses?: number;
  registryVersion: string;
  compilerVersion: string;
}

export type PipelineResult =
  | { kind: "failure"; status: Exclude<GatewayStatus, "ok"> }
  /** Task alignment stopped (misaligned) or held (ambiguous/unreviewed) the call before any commit. */
  | {
      kind: "alignment";
      outcome: "misaligned" | "ambiguous" | "unreviewed";
      reviewId: string | null;
      policy: AlignmentPolicy;
      findings: AlignmentFinding[];
      feedback: string | null;
    }
  | {
      kind: "decision";
      commit: CommitResult;
      capabilityToken: string | null;
      riskClass: string;
      approval: ApprovalStatus | null;
      /** Which task-alignment check ran for this call ("not_run" when the application has it off). */
      taskAlignment: "not_run" | "shadow" | "passed" | "covered_by_plan_review";
    };

export interface PipelineDeps {
  prepare: typeof prepareAuthorization;
  commit: typeof commitAuthorization;
  approval: typeof approvalForRequest;
  createProvider: (name: string, model: string) => SemanticRiskProvider;
  breakerFor: (key: string) => CircuitBreaker;
  /**
   * Both default to the GitHub-fixture-only registry (risk-class.ts's own
   * module-level instance) for every existing call site. A caller that has
   * already resolved this request's tenant (the `/api/v1/authorize` route
   * does, from `input.taskId`, before calling this function at all) injects
   * tenant-scoped versions here instead, so a tenant's published Custom API
   * operations get the same risk-classification and registry-approval
   * treatment a GitHub operation would, rather than silently falling back to
   * the "unknown tool" defaults (fail-safe "high" risk, but a lax "no
   * registry-required approval").
   */
  riskClassFor: typeof riskClassFor;
  registryRequiresApproval: typeof registryRequiresApproval;
  /** Task alignment's action check. Absent = not run (callers that inject their own deps keep exact old behavior). */
  actionCheck?: (input: ActionInput) => Promise<ActionCheck>;
  commitAligned?: typeof commitAuthorizationAligned;
  /** Task isolation (applications.require_task_sessions), independent of alignment. Absent = not checked. */
  credentialPolicy?: typeof taskCredentialPolicy;
}

export const defaultPipelineDeps: PipelineDeps = {
  prepare: prepareAuthorization,
  commit: commitAuthorization,
  approval: approvalForRequest,
  createProvider: createSemanticProvider,
  breakerFor,
  riskClassFor,
  registryRequiresApproval,
  actionCheck: (input) => checkAction(input),
  commitAligned: commitAuthorizationAligned,
  credentialPolicy: taskCredentialPolicy,
};

/**
 * The one trusted authorization path (Part 6):
 *
 *   gateway authentication → deterministic pre-evaluation (prepare)
 *   → semantic evaluation when configured → atomic commit
 *
 * The database commit re-runs the deterministic evaluation authoritatively,
 * composes it monotonically with the semantic evidence, persists everything
 * and issues the capability in ONE transaction. Nothing computed here is
 * trusted to widen anything: the semantic evidence is only an input to a
 * function that can only narrow.
 *
 * A semantic failure of any kind yields degraded evidence (never an
 * exception), which the database turns into either a fail-closed deny (when
 * semantic evidence is required for the call's risk class) or an explicit
 * degraded record that keeps the deterministic result (when optional).
 */
export async function authorizeThroughGateway(
  input: AuthorizeInput,
  deps: PipelineDeps = defaultPipelineDeps,
): Promise<PipelineResult> {
  const riskClass = deps.riskClassFor(input.tool);
  const maxUses = input.maxUses ?? 1;
  const argumentAudit = buildArgumentAudit(input.arguments);
  const resource = sanitizeResource(input.resource);

  // Task isolation first, and never tied to any review setting: an application that requires task
  // sessions refuses a raw (agent-scoped) runtime key on its tasks.
  if (deps.credentialPolicy && input.credentialSecret.startsWith("authority_rk_")) {
    if ((await deps.credentialPolicy(input.credentialSecret, input.taskId)) === "session_required") {
      return { kind: "failure", status: "session_required" };
    }
  }

  const prepared = await deps.prepare({
    credentialSecret: input.credentialSecret,
    taskId: input.taskId,
    tool: input.tool,
    args: input.arguments,
    idempotencyKey: input.idempotencyKey,
    registryVersion: input.registryVersion,
    compilerVersion: input.compilerVersion,
    riskClass,
    maxUses,
  });
  if (prepared.status !== "ok") return { kind: "failure", status: prepared.status };

  // Task alignment (off unless the task's application enabled it): authentication and task isolation, then a
  // review of this exact call -- outside any transaction. A deterministic refusal is never reviewed.
  const actionInput: ActionInput = {
    credentialSecret: input.credentialSecret,
    taskId: input.taskId,
    tool: input.tool,
    operation: input.operation,
    resource,
    args: input.arguments,
    idempotencyKey: input.idempotencyKey,
    detOutcome: prepared.detOutcome,
  };
  let action: ActionCheck = deps.actionCheck ? await deps.actionCheck(actionInput) : { kind: "off" };
  if (action.kind === "failure") return { kind: "failure", status: action.status };
  if (action.kind === "block") return alignmentResult(action);

  let evidence: SemanticEvidence | null = null;
  if (prepared.mode !== "off" && !prepared.alreadyDecided && prepared.provider && prepared.model) {
    const provider = deps.createProvider(prepared.provider, prepared.model);
    const prior = priorCallsSchema.safeParse(prepared.priorCalls);
    const result = await runSemanticEvaluation({
      provider,
      breaker: deps.breakerFor(`${provider.name}:${provider.model}`),
      timeoutMs: prepared.timeoutMs ?? undefined,
      input: {
        taskIntent: prepared.taskIntent ?? "(unknown)",
        tool: input.tool,
        operation: input.operation,
        resource,
        arguments: input.arguments,
        contractAllowedTools: prepared.allowedTools,
        priorCalls: prior.success ? prior.data : [],
      },
    });
    evidence = result.evidence;
  }

  const token = generateCapabilityToken();
  const commitInput = {
    credentialSecret: input.credentialSecret,
    taskId: input.taskId,
    tool: input.tool,
    operation: input.operation,
    resource,
    args: input.arguments,
    argumentAudit,
    planNodeId: input.planNodeId ?? null,
    idempotencyKey: input.idempotencyKey,
    registryVersion: input.registryVersion,
    compilerVersion: input.compilerVersion,
    riskClass,
    maxUses,
    tokenHash: token.hash,
    evidence,
    gatewayVersion: GATEWAY_VERSION,
    registryRequiresApproval: deps.registryRequiresApproval(input.tool),
  };
  let commit =
    action.kind === "clear" && deps.commitAligned
      ? await deps.commitAligned(action.reviewId, commitInput)
      : await deps.commit(commitInput);
  // The task's objectives or context changed between review and commit: review once more against the new state.
  if (commit.status === "alignment_stale" && deps.actionCheck && deps.commitAligned) {
    action = await deps.actionCheck(actionInput);
    if (action.kind === "failure") return { kind: "failure", status: action.status };
    if (action.kind === "block") return alignmentResult(action);
    if (action.kind === "clear") commit = await deps.commitAligned(action.reviewId, commitInput);
  }
  if (commit.status !== "ok") return { kind: "failure", status: commit.status };

  // Shadow alignment: reviewed after the decision, never awaited, never able to change it.
  if (action.kind === "shadow") {
    void action
      .after()
      .catch((error: unknown) =>
        safeLog(`task alignment shadow review failed (${error instanceof Error ? error.name : "unknown"})`),
      );
  }

  // Role C (shadow only): fired after commit has already succeeded, never awaited — a Jev outage or this write
  // itself failing can never affect the authorization decision or add latency to the agent's response. See
  // docs/jev/OVERVIEW.md. `commit.finalDecisionId` is only ever null on a replay, which this deliberately skips: a
  // replayed decision was already evaluated (and, if risk shadow mode was on then, already recorded) the first time.
  if (!commit.replayed && commit.finalDecisionId) {
    void runShadowRiskEvaluation({ input, prepared, commit, resource });
  }

  // A request awaiting approval reports the approval's state so the agent can poll it.
  const approval =
    commit.finalOutcome === "require_approval" && commit.toolRequestId
      ? await deps.approval({ credentialSecret: input.credentialSecret, toolRequestId: commit.toolRequestId })
      : null;

  return {
    kind: "decision",
    commit,
    approval: approval && approval.status === "ok" && approval.approvalId ? approval : null,
    // Plaintext leaves this function only when a capability was issued *now*.
    capabilityToken: commit.capabilityId && !commit.replayed ? token.plaintext : null,
    riskClass,
    taskAlignment:
      action.kind === "shadow"
        ? "shadow"
        : action.kind === "clear"
          ? action.covered
            ? "covered_by_plan_review"
            : "passed"
          : "not_run",
  };
}

function alignmentResult(action: Extract<ActionCheck, { kind: "block" }>): PipelineResult {
  return {
    kind: "alignment",
    outcome: action.outcome,
    reviewId: action.reviewId,
    policy: action.policy,
    findings: action.findings,
    feedback: action.feedback,
  };
}

/**
 * Role C, shadow mode only. Never awaited by `authorizeThroughGateway` and never throws out of this function — see
 * the call site's comment. `disagreement` is a coarse, advisory-only signal (not itself persisted as a decision):
 * true when Jev's risk class and the deterministic outcome point in qualitatively opposite directions.
 */
async function runShadowRiskEvaluation(args: {
  input: AuthorizeInput;
  prepared: { taskIntent: string | null; allowedTools: string[] };
  commit: CommitResult;
  resource: string | null;
}): Promise<void> {
  const { input, prepared, commit, resource } = args;
  try {
    const { tenantId, mode } = await jevRiskModeForTask(input.taskId);
    if (mode !== "shadow" || !tenantId) return;
    const env = getOpenRouterEnv();
    if (!env?.jevDecisionModel) return;

    let provider: OpenRouterJevRiskProvider;
    try {
      provider = new OpenRouterJevRiskProvider();
    } catch (error) {
      if (error instanceof JevProviderUnavailableError) return;
      throw error;
    }

    const riskInput: RiskEvaluationInput = {
      taskIntent: prepared.taskIntent ?? "(unknown)",
      tool: input.tool,
      operation: input.operation,
      resource,
      argumentKeys: Object.keys(input.arguments),
      contractAllowedTools: prepared.allowedTools,
      inProposedPlan: Boolean(input.planNodeId),
      expectedPlanNodeId: input.planNodeId ?? null,
      priorCallSummaries: [],
      remainingInvocations: commit.remainingInvocations,
      contractExpiresInSeconds: null,
    };
    const inputHash = canonicalHash(riskInput);
    const run = await runRiskEvaluation({
      provider,
      breaker: breakerFor(`jev-risk:${provider.model}`),
      input: riskInput,
    });

    const deterministicDecision = commit.detOutcome ?? "unknown";
    const finalDecision = commit.finalOutcome ?? "unknown";
    const permitted = new Set(["allow", "allow_constrained"]);
    const riskClass = run.evaluation?.riskClass;
    const disagreement =
      run.state === "ok" &&
      ((permitted.has(finalDecision) && (riskClass === "high" || riskClass === "critical")) ||
        (!permitted.has(finalDecision) && riskClass === "low"));

    // `jev_risk_evaluations.authorization_decision_id` has a foreign key to `authorization_decisions(id)` — the
    // DETERMINISTIC decision (`commit.decisionId`), not `final_decisions(id)` (`commit.finalDecisionId`), which
    // is a different id space entirely (mirrors `semantic_evaluations`'s identical column). Using the wrong one
    // here was a real bug: every shadow-mode risk evaluation failed its insert with a foreign-key violation,
    // silently swallowed by this function's own catch-and-log (never affecting the authorization decision
    // itself) — found only by a live run against the real database, since every prior test mocked this call.
    if (!commit.toolRequestId || !commit.decisionId) return;
    await recordRiskEvaluation({
      tenantId,
      taskId: input.taskId,
      toolRequestId: commit.toolRequestId,
      authorizationDecisionId: commit.decisionId,
      run,
      inputHash,
      deterministicDecision,
      finalDecision,
      disagreement,
    });
  } catch (error) {
    safeLog(`jev: shadow risk evaluation failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}
