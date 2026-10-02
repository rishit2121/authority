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

import { buildArgumentAudit, sanitizeResource, type ArgumentValue } from "./argument-audit";
import { generateCapabilityToken } from "./capability-token";
import { commitAuthorization, prepareAuthorization, type CommitResult, type GatewayStatus } from "./rpc";
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
  | {
      kind: "decision";
      commit: CommitResult;
      capabilityToken: string | null;
      riskClass: string;
      approval: ApprovalStatus | null;
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
}

export const defaultPipelineDeps: PipelineDeps = {
  prepare: prepareAuthorization,
  commit: commitAuthorization,
  approval: approvalForRequest,
  createProvider: createSemanticProvider,
  breakerFor,
  riskClassFor,
  registryRequiresApproval,
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
  const commit = await deps.commit({
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
  });
  if (commit.status !== "ok") return { kind: "failure", status: commit.status };

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
