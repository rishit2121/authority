import "server-only";

import {
  buildTrustedTaskInput,
  getOpenAiEnv,
  OpenAiPlanProposalProvider,
  OpenRouterJevRouterPlanProposalProvider,
  PlanProposalOutputTooLargeError,
  PlanProposalProviderError,
  PlanProposalTimeoutError,
  type PlanProposalProvider,
} from "@/lib/ai";
import {
  planStepsFrom,
  reviewPlanForTask,
  type AlignmentDeps,
  type PlanAlignment,
} from "@/lib/alignment/service";
import type { AlignmentFinding } from "@/lib/alignment/types";
import { getOpenRouterEnv } from "@/lib/openrouter/env";
import { deriveRequiredApprovals } from "@/lib/authorization/approval-rules";
import { canonicalHash } from "@/lib/authorization/canonicalize";
import { compileContract } from "@/lib/authorization/contract-compiler";
import { verifyCompiledContract } from "@/lib/authorization/contract-verifier";
import { PlanStructureError, validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import { candidatePlanSchema, type CandidatePlan } from "@/lib/domain";
import type { Json } from "@/lib/supabase/database.types";
import { buildTenantRegistry } from "@/lib/registry";
import {
  activateTaskContractForBackend,
  createCandidatePlanForBackend,
  getTaskForBackend,
  listActivePoliciesForBackend,
  proposeTaskContractForBackend,
} from "./rpc-tasks-lifecycle";

/**
 * The backend-credential equivalent of the dashboard's
 * `proposeContractAction` + `activateContractAction`
 * (`src/app/app/tasks/[taskId]/contract/actions.ts`) collapsed into one
 * call, because an application backend has no reason to make two round
 * trips for what is, from its point of view, one operation: "get this task
 * ready to run." Runs the identical validate -> solve -> compile -> derive
 * approvals -> verify pipeline, then persists through the backend-scoped
 * RPCs added in `20261003000014_developer_task_lifecycle_api.sql`, then
 * attempts automatic activation -- which succeeds unless one of the
 * organization's approval rules matched (a non-empty `requiredApprovalsSpec`,
 * see approval-rules.ts and `gateway.activate_task_contract_for_backend`).
 * A matched contract stays `proposed`, listed on the dashboard's Approvals
 * page until a person approves it.
 *
 * Deliberately NOT run here (unlike the dashboard path): the optional Jev
 * necessity pipeline and plan-completeness advisory. Both are tenant-opt-in,
 * advisory-only or narrowing-only (Jev can only ever REMOVE an operation the
 * mechanical solver already included, never add authority), and persisting
 * their evaluation records requires an RLS-scoped session this backend
 * credential does not have. Skipping them cannot widen what a backend-
 * prepared contract grants; it only means a tenant that has opted into Jev
 * shadow/enforce mode does not get its narrowing effect on backend-prepared
 * tasks yet. This is a stated scope limit, not a silent gap.
 */

/** Task-alignment review of this plan, when the application has it on (shadow never changes the outcome). */
export interface PlanAlignmentSummary {
  mode: "shadow" | "enforce";
  policy: "reference" | "production";
  outcome: "aligned" | "misaligned" | "ambiguous" | "unreviewed";
  decision: "approved" | "rejected" | null;
  reviewId: string | null;
  findings: AlignmentFinding[];
  feedback: string | null;
}

/** Which optional checks ran during prepare ("not_run" is never a pass). */
export interface PrepareChecks {
  planReview: "ran" | "not_run";
}

export type PrepareTaskOutcome =
  | {
      status: "ready";
      contractId: string;
      version: number;
      tools: string[];
      alignment?: PlanAlignmentSummary;
      checks?: PrepareChecks;
    }
  | {
      status: "awaiting_approval";
      contractId: string;
      version: number;
      approvalPath: string;
      alignment?: PlanAlignmentSummary;
      checks?: PrepareChecks;
    }
  /**
   * Enforced task-alignment review did not clear the plan. "revise": submit a different plan (or have the
   * exception approved); "hold": a person must review it. The contract exists but is not active.
   */
  | {
      status: "alignment_review";
      decision: "revise" | "hold";
      contractId: string;
      version: number;
      reviewPath: string;
      alignment: PlanAlignmentSummary;
      checks?: PrepareChecks;
    }
  | { status: "clarification"; reason: string; details?: unknown }
  | { status: "rejected"; reason: string }
  | { status: "ai_unavailable" };

export type PrepareTaskResult = { ok: true; outcome: PrepareTaskOutcome } | { ok: false; status: string };

export interface PrepareTaskInput {
  credentialSecret: string;
  taskId: string;
  /** Exactly one of `plan` or `generate` must be set. */
  plan?: unknown;
  generate?: boolean;
  idempotencyKey?: string | null;
}

function nodesFor(plan: CandidatePlan, validation: ReturnType<typeof validateCandidatePlan>) {
  return plan.nodes.map((n) => {
    const finding = validation.findings.find((f) => f.nodeId === n.id);
    return {
      id: n.id,
      sequence: n.sequence,
      tool: n.tool,
      arguments: n.arguments,
      resourceBinding: n.resourceBinding ?? null,
      dependencies: n.dependencies,
      declaredOutputs: n.declaredOutputs,
      dataFlowRefs: n.dataFlowRefs,
      maxInvocations: n.maxInvocations,
      validationStatus: finding?.status ?? "pending",
      expectedSideEffect: n.expectedSideEffect,
    };
  });
}

/**
 * Models often emit `resourceBinding: ""` for a step with no resource; the
 * schema (rightly) rejects an empty binding, but it means exactly the same as
 * omitting one. Applied only to AI-drafted plans -- a developer's own plan is
 * validated exactly as submitted.
 */
export function withoutEmptyResourceBindings(plan: unknown): unknown {
  if (!plan || typeof plan !== "object" || !Array.isArray((plan as { nodes?: unknown }).nodes)) return plan;
  const typed = plan as { nodes: unknown[] };
  return {
    ...typed,
    nodes: typed.nodes.map((node) => {
      if (!node || typeof node !== "object" || (node as { resourceBinding?: unknown }).resourceBinding !== "")
        return node;
      const rest = { ...(node as Record<string, unknown>) };
      delete rest.resourceBinding;
      return rest;
    }),
  };
}

function summarize(a: PlanAlignment, reviewId: string | null): PlanAlignmentSummary {
  return {
    mode: a.mode,
    policy: a.policy,
    outcome: a.outcome,
    decision: a.decision,
    reviewId,
    findings: a.findings,
    feedback: a.feedback,
  };
}

export async function prepareTask(
  input: PrepareTaskInput,
  options: { alignmentDeps?: AlignmentDeps } = {},
): Promise<PrepareTaskResult> {
  const task = await getTaskForBackend(input.credentialSecret, input.taskId);
  if (task.status !== "ok" || !task.tenantId || task.intent === null) {
    return { ok: false, status: task.status };
  }

  const [{ status: policiesStatus, policies: activePolicies }, registry] = await Promise.all([
    listActivePoliciesForBackend(input.credentialSecret, task.tenantId),
    buildTenantRegistry(task.tenantId),
  ]);
  if (policiesStatus !== "ok") return { ok: false, status: policiesStatus };

  let rawPlan: unknown;
  if (input.generate) {
    const provider: PlanProposalProvider | null = getOpenAiEnv()
      ? new OpenAiPlanProposalProvider()
      : getOpenRouterEnv()
        ? new OpenRouterJevRouterPlanProposalProvider()
        : null;
    if (!provider) {
      return { ok: true, outcome: { status: "ai_unavailable" } };
    }
    const trustedInput = buildTrustedTaskInput({
      taskId: input.taskId,
      taskIntent: task.intent,
      registry,
      activePolicies,
      resourceReferences: [],
    });
    try {
      const generated = await provider.proposePlan(trustedInput);
      rawPlan = withoutEmptyResourceBindings(generated.plan);
    } catch (error) {
      if (
        error instanceof PlanProposalTimeoutError ||
        error instanceof PlanProposalOutputTooLargeError ||
        error instanceof PlanProposalProviderError
      ) {
        return {
          ok: true,
          outcome: { status: "clarification", reason: `AI plan generation failed: ${error.message}` },
        };
      }
      throw error;
    }
  } else {
    rawPlan = input.plan;
  }

  const parsed = candidatePlanSchema.safeParse(rawPlan);
  if (!parsed.success) {
    return {
      ok: true,
      outcome: {
        status: "clarification",
        reason: `The candidate plan does not match the expected structure: ${parsed.error.issues[0]?.message ?? "invalid shape"}`,
        details: input.generate ? rawPlan : undefined,
      },
    };
  }
  const plan: CandidatePlan = parsed.data;
  if (plan.taskId !== input.taskId) {
    return {
      ok: true,
      outcome: { status: "clarification", reason: "The candidate plan's taskId does not match this task." },
    };
  }

  let validation: ReturnType<typeof validateCandidatePlan>;
  try {
    validation = validateCandidatePlan(plan, { registry, activePolicies });
  } catch (error) {
    // A structurally broken plan (a step depending on itself or on a later
    // step, duplicate ids, ...) is the plan author's mistake -- an AI planner's
    // or a developer's -- not a server failure: answer it like any other plan
    // that can't be compiled, never with a 500.
    if (error instanceof PlanStructureError) {
      return {
        ok: true,
        outcome: { status: "clarification", reason: `The candidate plan is malformed: ${error.message}` },
      };
    }
    throw error;
  }
  if (validation.includedNodeIds.length === 0) {
    return {
      ok: true,
      outcome: {
        status: "clarification",
        reason: "No plan node was accepted or review-pending -- there is nothing to compile a contract from.",
      },
    };
  }

  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") {
    return {
      ok: true,
      outcome: {
        status: "rejected",
        reason: `The minimum-authority solver could not produce a contract (${solverOutcome.status}).`,
      },
    };
  }

  const compiled = compileContract({ candidatePlan: plan, validation, solverOutcome, registry });
  const requiredApprovalsSpec = deriveRequiredApprovals({
    candidatePlan: plan,
    validation,
    solverOutcome,
    registry,
    activePolicies,
  });

  const verification = verifyCompiledContract({
    candidatePlan: plan,
    registry,
    activePolicies,
    compiled,
    tenantId: task.tenantId,
    taskId: input.taskId,
    maxAllowedExpirySeconds: 24 * 3600,
    supportedRegistryVersions: [registry.registryVersion],
    supportedCompilerVersions: [compiled.compilerVersion],
  });
  if (!verification.ok) {
    const firstFailure = verification.checks.find((c) => !c.passed);
    return {
      ok: true,
      outcome: {
        status: "rejected",
        reason: `Independent verification failed: ${firstFailure?.detail ?? "unknown check"}`,
      },
    };
  }

  const inputHash = canonicalHash({
    schemaVersion: plan.schemaVersion,
    taskId: plan.taskId,
    registryVersion: registry.registryVersion,
    includedNodes: plan.nodes
      .filter((n) => validation.includedNodeIds.includes(n.id))
      .sort((a, b) => a.sequence - b.sequence),
  });

  // Task alignment (off unless the application enabled it): does each step, with its concrete values,
  // serve the user's request? Run before anything is persisted, and re-run for every new plan.
  const alignment = await reviewPlanForTask({
    secret: input.credentialSecret,
    taskId: input.taskId,
    steps: planStepsFrom(plan, validation.includedNodeIds, registry),
    subjectHash: compiled.inputHash,
    deps: options.alignmentDeps,
  });

  const planResult = await createCandidatePlanForBackend({
    credentialSecret: input.credentialSecret,
    taskId: input.taskId,
    nodes: nodesFor(plan, validation),
    inputHash,
    idempotencyKey: input.idempotencyKey,
  });
  if (planResult.status !== "ok" || !planResult.planId) {
    return { ok: false, status: planResult.status };
  }

  const contractResult = await proposeTaskContractForBackend({
    credentialSecret: input.credentialSecret,
    taskId: input.taskId,
    planId: planResult.planId,
    allowedActions: { schemaVersion: 1, items: compiled.allowedActions } as unknown as Json,
    forbiddenResources: compiled.forbiddenResources,
    forbiddenOperations: compiled.forbiddenOperations,
    ephemeralLimits: { schemaVersion: 1, ...compiled.ephemeralLimits } as unknown as Json,
    dataFlowBindings: { schemaVersion: 1, refs: compiled.dataFlowBindings } as unknown as Json,
    requiredApprovals: { schemaVersion: 1, items: compiled.requiredApprovals } as unknown as Json,
    requiredApprovalsSpec: { schemaVersion: 1, items: requiredApprovalsSpec } as unknown as Json,
    registryVersion: compiled.registryVersion,
    compilerVersion: compiled.compilerVersion,
    inputHash: compiled.inputHash,
    outputHash: compiled.outputHash,
    verifierResult: { schemaVersion: 1, ok: verification.ok, checks: verification.checks } as unknown as Json,
    objectiveTrace: {
      schemaVersion: 1,
      excessOperationCount: solverOutcome.solution.score.excessOperationCount,
      totalRiskCost: solverOutcome.solution.score.totalRiskCost,
      totalResourceBreadth: solverOutcome.solution.score.totalResourceBreadth,
      permissionCount: solverOutcome.solution.score.permissionCount,
      selectedPermissionIds: solverOutcome.solution.selectedPermissionIds,
    } as unknown as Json,
  });
  if (contractResult.status !== "ok" || !contractResult.contractId || contractResult.version === null) {
    return { ok: false, status: contractResult.status };
  }

  let alignmentSummary: PlanAlignmentSummary | undefined;
  if (alignment) {
    const reviewId =
      alignment.reviewId ?? (alignment.record ? await alignment.record(contractResult.contractId) : null);
    alignmentSummary = summarize(alignment, reviewId);
    // Enforcement: the contract stays inactive until the plan is aligned or a person approves the exception.
    // gateway.activate_task_contract_core checks the same thing independently.
    if (alignment.mode === "enforce" && (!alignment.cleared || !reviewId)) {
      return {
        ok: true,
        outcome: {
          status: "alignment_review",
          decision:
            alignment.outcome === "misaligned" || alignment.decision === "rejected" ? "revise" : "hold",
          contractId: contractResult.contractId,
          version: contractResult.version,
          reviewPath: `/app/tasks/${input.taskId}`,
          alignment: alignmentSummary,
          checks: { planReview: "ran" },
        },
      };
    }
  }

  const activation = await activateTaskContractForBackend(input.credentialSecret, contractResult.contractId);
  if (activation === "ok") {
    return {
      ok: true,
      outcome: {
        status: "ready",
        contractId: contractResult.contractId,
        version: contractResult.version,
        tools: [...new Set(compiled.allowedActions.map((a) => a.tool))],
        ...(alignmentSummary ? { alignment: alignmentSummary } : {}),
        checks: { planReview: alignmentSummary ? "ran" : "not_run" },
      },
    };
  }

  return {
    ok: true,
    outcome: {
      status: "awaiting_approval",
      contractId: contractResult.contractId,
      version: contractResult.version,
      approvalPath: `/app/tasks/${input.taskId}`,
      ...(alignmentSummary ? { alignment: alignmentSummary } : {}),
      checks: { planReview: alignmentSummary ? "ran" : "not_run" },
    },
  };
}
