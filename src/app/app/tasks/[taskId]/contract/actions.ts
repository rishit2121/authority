"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import {
  buildTrustedTaskInput,
  getOpenAiEnv,
  MockPlanProposalProvider,
  OpenAiPlanProposalProvider,
  OpenRouterJevRouterPlanProposalProvider,
  PlanProposalOutputTooLargeError,
  PlanProposalProviderError,
  PlanProposalTimeoutError,
  type PlanProposalMetadata,
  type PlanProposalProvider,
} from "@/lib/ai";
import { getOpenRouterEnv } from "@/lib/openrouter/env";
import type { JevNodeRecord } from "@/lib/jev/contract-pipeline";
import {
  checkPlanCompleteness,
  loadModeAndRunPipeline,
  persistCompletenessCheck,
  persistNecessityRecords,
} from "@/lib/jev/propose-integration";
import { deriveRequiredApprovals } from "@/lib/authorization/approval-rules";
import { canonicalHash } from "@/lib/authorization/canonicalize";
import { COMPILER_VERSION, compileContract } from "@/lib/authorization/contract-compiler";
import { verifyCompiledContract } from "@/lib/authorization/contract-verifier";
import {
  PlanStructureError,
  validateCandidatePlan,
  type PlanValidationResult,
} from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import { candidatePlanSchema, type ApprovalRequirement, type CandidatePlan } from "@/lib/domain";
import {
  callActivateTaskContract,
  callCreateCandidatePlan,
  callDecideContractApproval,
  callProposeTaskContract,
  callRaiseTaskBudgets,
  callRejectContract,
  callRevokeTaskContract,
  callSubmitContractForApproval,
  type CreateCandidatePlanNodeInput,
} from "@/lib/persistence/rpc";
import type { Json } from "@/lib/supabase/database.types";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { RepositoryError } from "@/lib/persistence/errors";
import { loadCandidatePlanForActivation } from "@/lib/persistence/supabase/load-candidate-plan-for-activation";
import { buildTenantRegistry } from "@/lib/registry";

/**
 * Server actions for the candidate-plan / contract-proposal workflow.
 *
 * Every action here re-derives tenant and role from the caller's own
 * verified session via createRepositoriesForCurrentTenant() — nothing is
 * ever trusted from the browser about who the caller is or which tenant
 * they're acting in. The registry, validator, solver, compiler and verifier
 * all run here, server-side, in this same process — never in the browser,
 * never via a model. See lib/authorization/contract-verifier.ts's module
 * doc for exactly what server-side verification does and does not prove
 * once the result reaches the database.
 */

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function presentActionError(error: unknown): string {
  if (error instanceof PlanStructureError) {
    return `The candidate plan is structurally invalid: ${error.message}`;
  }
  if (error instanceof RepositoryError) {
    switch (error.code) {
      case "tenant_mismatch":
        return "That action doesn't apply to your current workspace.";
      case "not_found":
        return "That record could not be found.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "42501") return "You don't have permission to do that.";
    if (code === "23505") return "This exact submission was already made with different content.";
  }
  return "Something went wrong. Please try again.";
}

/**
 * Loads this task's active policies and the registry this tenant's plan
 * should be checked against -- the GitHub fixture plus whatever Custom API
 * operations this tenant has published (see src/lib/registry/tenant.ts).
 * Every registry-dependent action builds its own tenant-scoped instance
 * through this helper rather than sharing one process-global registry,
 * since which custom operations are available differs per tenant.
 */
async function loadActivePoliciesAndRegistry(taskId: string) {
  const { repositories, identity } = await createRepositoriesForCurrentTenant(
    `/app/tasks/${taskId}/contract/new`,
  );
  const [allPolicies, registry] = await Promise.all([
    repositories.policies.listByTenant(identity.tenant.tenantId),
    buildTenantRegistry(identity.tenant.tenantId),
  ]);
  return { activePolicies: allPolicies.filter((p) => p.status === "active"), registry, identity };
}

export interface ValidatePlanResult {
  findings: PlanValidationResult["findings"];
  acceptedNodeIds: string[];
  /** Accepted or requires_review — everything eligible to reach the solver. See plan-validator.ts. */
  includedNodeIds: string[];
  requiredOperations: string[];
}

/**
 * Validates a candidate plan and returns findings only — nothing is
 * persisted. Purely informational preview for the UI while a user is still
 * editing; treated as untrusted scratch state until it comes back from the
 * database after a real proposal.
 */
export async function validateCandidatePlanAction(
  taskId: string,
  rawPlan: unknown,
): Promise<ActionResult<ValidatePlanResult>> {
  try {
    const { activePolicies, registry } = await loadActivePoliciesAndRegistry(taskId);
    const parsed = candidatePlanSchema.safeParse(rawPlan);
    if (!parsed.success) {
      return {
        ok: false,
        error: `The candidate plan does not match the expected structure: ${parsed.error.issues[0]?.message ?? "invalid shape"}`,
      };
    }
    if (parsed.data.taskId !== taskId) {
      return { ok: false, error: "The candidate plan's taskId does not match this task." };
    }

    const validation = validateCandidatePlan(parsed.data, { registry, activePolicies });
    return {
      ok: true,
      data: {
        findings: validation.findings,
        acceptedNodeIds: validation.acceptedNodeIds,
        includedNodeIds: validation.includedNodeIds,
        requiredOperations: validation.requiredOperations,
      },
    };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

/** Non-authoritative summary for the UI — see docs/jev/OVERVIEW.md. Absent entirely when necessity evaluation did not run (mode "off" or Jev unconfigured). */
export interface JevProposalSummary {
  mode: "shadow" | "enforce";
  toolsProposed: number;
  toolsAccepted: number;
  toolsRemovedAsUnnecessary: number;
  nodes: Array<{
    nodeId: string;
    tool: string;
    mechanicalStatus: string;
    finalStatus: string;
    classification: string | null;
    confidence: number | null;
    reasonCodes: string[];
    alternativeOperationIds: string[];
    state: string;
    disagreement: boolean;
    provider: string;
    model: string;
  }>;
}

/** Plan-level completeness (role B extension) — always advisory, never adds or removes a plan node. Absent when the mode is "off" or Jev is unconfigured. */
export interface JevCompletenessSummary {
  state: string;
  classification: string | null;
  confidence: number | null;
  possibleMissingOperationIds: string[];
}

export interface ProposeContractPreview {
  contractId: string;
  version: number;
  wasCreated: boolean;
  selectedPermissionIds: string[];
  excessOperations: string[];
  requiredApprovals: ApprovalRequirement[];
  jev: JevProposalSummary | null;
  jevCompleteness: JevCompletenessSummary | null;
}

function summarizeJevRecords(mode: "shadow" | "enforce", records: JevNodeRecord[]): JevProposalSummary {
  const evaluated = records.filter((r) => r.necessityRun);
  return {
    mode,
    toolsProposed: records.length,
    toolsAccepted: records.filter((r) => r.finalStatus === "accepted" || r.finalStatus === "requires_review")
      .length,
    toolsRemovedAsUnnecessary: records.filter(
      (r) =>
        r.mechanicalStatus !== r.finalStatus && (r.finalStatus === "replan" || r.finalStatus === "clarify"),
    ).length,
    nodes: evaluated.map((r) => ({
      nodeId: r.nodeId,
      tool: r.tool,
      mechanicalStatus: r.mechanicalStatus,
      finalStatus: r.finalStatus,
      classification: r.necessityRun?.evaluation?.classification ?? null,
      confidence: r.necessityRun?.evaluation?.confidence ?? null,
      reasonCodes: r.necessityRun?.evaluation?.reasonCodes ?? [],
      alternativeOperationIds: r.necessityRun?.evaluation?.alternativeOperationIds ?? [],
      state: r.necessityRun?.state ?? "unavailable",
      disagreement: r.disagreement,
      provider: r.necessityRun?.provider ?? "",
      model: r.necessityRun?.model ?? "",
    })),
  };
}

/**
 * Full pipeline: re-validate (never trust a prior round-trip), solve,
 * compile, independently verify, and only then persist via the two narrow
 * RPCs. If this process's own verifier finds a problem, the proposal is
 * refused before either RPC is ever called — this is the one place in the
 * whole pipeline where failing verification actually blocks anything,
 * since the database cannot meaningfully evaluate a claimed verifier
 * result (see contract-verifier.ts's module doc).
 */
export async function proposeContractAction(
  taskId: string,
  rawPlan: unknown,
  idempotencyKey?: string,
): Promise<ActionResult<ProposeContractPreview>> {
  try {
    const { repositories, identity, context } = await createRepositoriesForCurrentTenant(
      `/app/tasks/${taskId}/contract/new`,
    );
    const [allPolicies, registry] = await Promise.all([
      repositories.policies.listByTenant(identity.tenant.tenantId),
      buildTenantRegistry(identity.tenant.tenantId),
    ]);
    const activePolicies = allPolicies.filter((p) => p.status === "active");

    const parsed = candidatePlanSchema.safeParse(rawPlan);
    if (!parsed.success) {
      return {
        ok: false,
        error: `The candidate plan does not match the expected structure: ${parsed.error.issues[0]?.message ?? "invalid shape"}`,
      };
    }
    const plan: CandidatePlan = parsed.data;
    if (plan.taskId !== taskId) {
      return { ok: false, error: "The candidate plan's taskId does not match this task." };
    }

    const mechanicalValidation = validateCandidatePlan(plan, { registry, activePolicies });
    if (mechanicalValidation.includedNodeIds.length === 0) {
      return {
        ok: false,
        error: "No plan node was accepted or review-pending — there is nothing to compile a contract from.",
      };
    }

    const task = await repositories.tasks.findById(taskId);
    if (!task || task.tenantId !== identity.tenant.tenantId) {
      return { ok: false, error: "That task could not be found." };
    }
    const [{ mode: jevMode, result: jevResult }, completenessCheck] = await Promise.all([
      loadModeAndRunPipeline({
        context,
        tenantId: identity.tenant.tenantId,
        candidatePlan: plan,
        taskIntent: task.intent,
        validation: mechanicalValidation,
        registry,
        activePolicies,
      }),
      checkPlanCompleteness({
        context,
        tenantId: identity.tenant.tenantId,
        taskId,
        taskIntent: task.intent,
        candidatePlan: plan,
        registry,
        activePolicies,
      }),
    ]);
    const validation = jevResult.adjustedValidation;
    const jevSummary = jevMode === "off" ? null : summarizeJevRecords(jevMode, jevResult.nodeRecords);
    if (validation.includedNodeIds.length === 0) {
      return {
        ok: false,
        error:
          "No plan node remained accepted or review-pending after necessity evaluation — there is nothing to compile a contract from.",
      };
    }

    const solverOutcome = solveMinimumAuthority({
      requiredOperations: validation.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") {
      return {
        ok: false,
        error: `The minimum-authority solver could not produce a contract (${solverOutcome.status}).`,
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
      // Compiled from Jev's adjusted validation; the verifier accepts it only as a narrowing of the mechanical one.
      narrowedValidation: validation,
      tenantId: identity.tenant.tenantId,
      taskId,
      maxAllowedExpirySeconds: 24 * 3600,
      supportedRegistryVersions: [registry.registryVersion],
      supportedCompilerVersions: [compiled.compilerVersion],
    });
    if (!verification.ok) {
      const firstFailure = verification.checks.find((c) => !c.passed);
      return {
        ok: false,
        error: `Independent verification failed: ${firstFailure?.detail ?? "unknown check"}`,
      };
    }

    const planNodesInput: CreateCandidatePlanNodeInput[] = plan.nodes.map((n) => {
      const finding = validation.findings.find((f) => f.nodeId === n.id);
      const validationStatus: CreateCandidatePlanNodeInput["validationStatus"] = finding?.status ?? "pending";
      return {
        id: n.id,
        sequence: n.sequence,
        tool: n.tool,
        arguments: n.arguments,
        resourceBinding: n.resourceBinding,
        dependencies: n.dependencies,
        declaredOutputs: n.declaredOutputs,
        dataFlowRefs: n.dataFlowRefs,
        maxInvocations: n.maxInvocations,
        validationStatus,
        expectedSideEffect: n.expectedSideEffect,
      };
    });

    const inputHash = canonicalHash({
      schemaVersion: plan.schemaVersion,
      taskId: plan.taskId,
      registryVersion: registry.registryVersion,
      includedNodes: plan.nodes
        .filter((n) => validation.includedNodeIds.includes(n.id))
        .sort((a, b) => a.sequence - b.sequence),
    });

    const planResult = await callCreateCandidatePlan(context, {
      taskId,
      nodes: planNodesInput,
      inputHash,
      idempotencyKey,
    });

    if (jevMode !== "off") {
      await persistNecessityRecords(context, {
        tenantId: identity.tenant.tenantId,
        taskId,
        planId: planResult.planId,
        registryVersion: registry.registryVersion,
        compilerVersion: COMPILER_VERSION,
        mode: jevMode,
        result: jevResult,
      });
    }
    if (completenessCheck.run && completenessCheck.inputHash) {
      await persistCompletenessCheck(context, {
        tenantId: identity.tenant.tenantId,
        taskId,
        planId: planResult.planId,
        run: completenessCheck.run,
        inputHash: completenessCheck.inputHash,
      });
    }
    const jevCompleteness: JevCompletenessSummary | null = completenessCheck.run
      ? {
          state: completenessCheck.run.state,
          classification: completenessCheck.run.evaluation?.classification ?? null,
          confidence: completenessCheck.run.evaluation?.confidence ?? null,
          possibleMissingOperationIds: completenessCheck.run.evaluation?.possibleMissingOperationIds ?? [],
        }
      : null;

    // The compiler's own output is the unwrapped, logical shape it hashes
    // and the verifier checks against. The database's schema-versioned
    // JSONB columns expect a `{schemaVersion, ...}` envelope around that
    // same content (enforced by e.g. `task_authority_contracts_allowed_actions_check`
    // and `tac_data_flow_bindings_versioned`) — wrapping happens only here,
    // at the persistence boundary, matching the exact envelope shapes the
    // RPC's own pgTAP fixtures use (see supabase/tests/14_contract_lifecycle.sql).
    const contractResult = await callProposeTaskContract(context, {
      taskId,
      planId: planResult.planId,
      allowedActions: {
        schemaVersion: 1,
        items: compiled.allowedActions,
      } as unknown as Json,
      forbiddenResources: compiled.forbiddenResources,
      forbiddenOperations: compiled.forbiddenOperations,
      ephemeralLimits: {
        schemaVersion: 1,
        ...compiled.ephemeralLimits,
      } as unknown as Json,
      dataFlowBindings: {
        schemaVersion: 1,
        refs: compiled.dataFlowBindings,
      } as unknown as Json,
      requiredApprovals: {
        schemaVersion: 1,
        items: compiled.requiredApprovals,
      } as unknown as Json,
      requiredApprovalsSpec: {
        schemaVersion: 1,
        items: requiredApprovalsSpec,
      } as unknown as Json,
      registryVersion: compiled.registryVersion,
      compilerVersion: compiled.compilerVersion,
      inputHash: compiled.inputHash,
      outputHash: compiled.outputHash,
      // Plain checks/scores are already JSON-serializable at runtime; the
      // cast only works around TS interfaces lacking an index signature,
      // it never bypasses any actual validation of the content.
      verifierResult: {
        schemaVersion: 1,
        ok: verification.ok,
        checks: verification.checks,
      } as unknown as Json,
      objectiveTrace: {
        schemaVersion: 1,
        excessOperationCount: solverOutcome.solution.score.excessOperationCount,
        totalRiskCost: solverOutcome.solution.score.totalRiskCost,
        totalResourceBreadth: solverOutcome.solution.score.totalResourceBreadth,
        permissionCount: solverOutcome.solution.score.permissionCount,
        selectedPermissionIds: solverOutcome.solution.selectedPermissionIds,
      },
    });

    revalidatePath(`/app/tasks/${taskId}`);
    revalidatePath("/app");

    return {
      ok: true,
      data: {
        contractId: contractResult.contractId,
        version: contractResult.version,
        wasCreated: contractResult.wasCreated,
        selectedPermissionIds: solverOutcome.solution.selectedPermissionIds,
        excessOperations: solverOutcome.solution.excessOperations,
        requiredApprovals: requiredApprovalsSpec,
        jev: jevSummary,
        jevCompleteness,
      },
    };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function submitContractForApprovalAction(
  taskId: string,
  contractId: string,
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
    await callSubmitContractForApproval(context, contractId);
    revalidatePath(`/app/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function rejectContractAction(
  taskId: string,
  contractId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
    await callRejectContract(context, contractId, reason);
    revalidatePath(`/app/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export interface GeneratedPlanPreview {
  /** Raw, unvalidated JSON straight from the provider — the UI must label this untrusted regardless of whether it happens to already be well-formed. */
  plan: unknown;
  metadata: PlanProposalMetadata;
  /** Present only when the provider's output failed candidatePlanSchema — the UI shows this instead of silently discarding a malformed proposal. */
  validationError?: string;
}

/**
 * Generates an untrusted candidate plan via the configured AI provider
 * (OpenAI if `OPENAI_API_KEY` is set, the deterministic mock otherwise —
 * either way, this action never activates anything, never selects a
 * permission, and never touches the deterministic pipeline itself). The
 * result is always labeled untrusted in the UI
 * (`UNTRUSTED_AI_PLAN_LABEL`) and must still pass through
 * `validateCandidatePlanAction`/`proposeContractAction` exactly like a
 * hand-authored plan — this action does not call either of those itself,
 * so a human always reviews the raw output first.
 */
export async function generatePlanWithAiAction(taskId: string): Promise<ActionResult<GeneratedPlanPreview>> {
  try {
    const { repositories, identity } = await createRepositoriesForCurrentTenant(
      `/app/tasks/${taskId}/contract/new`,
    );
    const task = await repositories.tasks.findById(taskId);
    if (!task || task.tenantId !== identity.tenant.tenantId) {
      return { ok: false, error: "That task could not be found." };
    }

    const [allPolicies, registry] = await Promise.all([
      repositories.policies.listByTenant(identity.tenant.tenantId),
      buildTenantRegistry(identity.tenant.tenantId),
    ]);
    const activePolicies = allPolicies.filter((p) => p.status === "active");

    const trustedInput = buildTrustedTaskInput({
      taskId,
      taskIntent: task.intent,
      registry,
      activePolicies,
      resourceReferences: [],
    });

    // OpenAI takes precedence when both happen to be configured, so an existing setup's behavior never changes
    // merely because OPENROUTER_API_KEY was later added; OpenRouter (typesafe/jev-router) is the alternative that
    // needs no OpenAI key at all. Neither configured falls back to a labeled mock, exactly as before.
    const provider: PlanProposalProvider = getOpenAiEnv()
      ? new OpenAiPlanProposalProvider()
      : getOpenRouterEnv()
        ? new OpenRouterJevRouterPlanProposalProvider()
        : new MockPlanProposalProvider();

    const result = await provider.proposePlan(trustedInput);
    const parsed = candidatePlanSchema.safeParse(result.plan);

    return {
      ok: true,
      data: {
        plan: result.plan,
        metadata: result.metadata,
        validationError: parsed.success
          ? undefined
          : `The AI provider's output did not match the required plan structure: ${parsed.error.issues[0]?.message ?? "invalid shape"}`,
      },
    };
  } catch (error) {
    if (
      error instanceof PlanProposalTimeoutError ||
      error instanceof PlanProposalOutputTooLargeError ||
      error instanceof PlanProposalProviderError
    ) {
      return { ok: false, error: `AI plan generation failed: ${error.message}` };
    }
    return { ok: false, error: presentActionError(error) };
  }
}

export interface ContractApprovalView {
  id: string;
  requiredKind: "task_owner" | "role";
  requiredRole?: string;
  status: "pending" | "approved" | "rejected" | "expired";
  summary: string;
  respondedByPrincipalId?: string;
  responseNote?: string;
}

/**
 * The pending/decided approval slots for one contract version — for the
 * required-approval and activation-readiness panels. Every row here is
 * bound to this exact contract id; a later recompilation starts over at
 * zero regardless of how this version's requirements were resolved.
 */
export async function listContractApprovalsAction(
  taskId: string,
  contractId: string,
): Promise<ActionResult<ContractApprovalView[]>> {
  try {
    const { repositories } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
    const approvals = await repositories.approvals.listByTaskId(taskId);
    const rows = approvals
      .filter((a) => a.contractId === contractId)
      .map((a) => ({
        id: a.id,
        requiredKind: a.requiredKind!,
        requiredRole: a.requiredRole,
        status: a.status,
        summary: a.summary,
        respondedByPrincipalId: a.respondedByPrincipalId,
        responseNote: a.responseNote,
      }));
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function decideContractApprovalAction(
  taskId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
    await callDecideContractApproval(context, approvalId, decision, reason);
    revalidatePath(`/app/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

/**
 * The one path that can grant real runtime authority. Before ever calling
 * `activate_task_contract()`, this re-runs the *entire* deterministic
 * pipeline (validate -> solve -> compile -> verify -> derive approvals)
 * against the *currently* supported registry version and the tenant's
 * *current* active policies, using the plan reconstructed from what was
 * actually persisted — never the contract row's own stored content, which
 * this only uses for comparison. Activation is refused, before the RPC is
 * ever called, unless every one of these matches exactly:
 *
 *   - the recompiled inputHash/outputHash equal the persisted contract's
 *   - the recompiled required-approvals spec equals the persisted one
 *   - the registry/compiler versions are still ones this server currently
 *     supports (fails closed on anything else, including a version this
 *     server no longer recognizes at all)
 *
 * This is the enforcement half of the trust boundary described in
 * `20260926000006_contract_activation_rpcs.sql`'s module doc: the database
 * cannot prove this function ran, so this function is what makes activating
 * a stale or forged proposal fail *before* the one RPC that could ever
 * grant authority is ever invoked. Passing this check does not itself grant
 * anything — `activate_task_contract()` still independently re-checks role,
 * approval satisfaction and the single-active-contract invariant.
 */
export async function activateContractAction(taskId: string, contractId: string): Promise<ActionResult> {
  try {
    const { repositories, identity, context } = await createRepositoriesForCurrentTenant(
      `/app/tasks/${taskId}`,
    );

    const contract = await repositories.contracts.findById(contractId);
    if (!contract || contract.tenantId !== identity.tenant.tenantId || contract.taskId !== taskId) {
      return { ok: false, error: "That contract could not be found." };
    }
    if (!contract.planId || !contract.registryVersion || !contract.compilerVersion) {
      return { ok: false, error: "This contract predates activation support and cannot be activated." };
    }

    const registry = await buildTenantRegistry(identity.tenant.tenantId);
    const supportedRegistryVersions = [registry.registryVersion];
    const supportedCompilerVersions = [COMPILER_VERSION];
    if (!supportedRegistryVersions.includes(contract.registryVersion)) {
      return { ok: false, error: `Registry version "${contract.registryVersion}" is no longer supported.` };
    }
    if (!supportedCompilerVersions.includes(contract.compilerVersion)) {
      return { ok: false, error: `Compiler version "${contract.compilerVersion}" is no longer supported.` };
    }

    const plan = await loadCandidatePlanForActivation(context, taskId, contract.planId);

    const allPolicies = await repositories.policies.listByTenant(identity.tenant.tenantId);
    const activePolicies = allPolicies.filter((p) => p.status === "active");

    const mechanicalValidation = validateCandidatePlan(plan, { registry, activePolicies });
    if (mechanicalValidation.includedNodeIds.length === 0) {
      return { ok: false, error: "Re-validation found nothing left to authorize; this proposal is stale." };
    }

    const activationTask = await repositories.tasks.findById(taskId);
    if (!activationTask) return { ok: false, error: "That task could not be found." };
    // Re-runs the SAME Jev necessity pipeline used at proposal time, under the tenant's CURRENT setting. In "shadow"
    // mode (or when Jev is off/unconfigured) this reproduces the mechanical result exactly, so it never affects
    // activation. In "enforce" mode it must be re-run here because the persisted contract's hash was computed from
    // the *Jev-adjusted* plan, not the raw mechanical one — but because this calls a live model again rather than
    // replaying the exact propose-time decision, a classification that comes back even slightly differently this
    // time (Jev is not guaranteed byte-stable across calls) will correctly be treated as "this would compile
    // differently now" below, the same conservative failure this check already gives for a registry/policy change.
    // See docs/jev/OVERVIEW.md's limitations.
    const { result: activationJevResult } = await loadModeAndRunPipeline({
      context,
      tenantId: identity.tenant.tenantId,
      candidatePlan: plan,
      taskIntent: activationTask.intent,
      validation: mechanicalValidation,
      registry,
      activePolicies,
    });
    const validation = activationJevResult.adjustedValidation;
    if (validation.includedNodeIds.length === 0) {
      return { ok: false, error: "Re-validation found nothing left to authorize; this proposal is stale." };
    }

    const solverOutcome = solveMinimumAuthority({
      requiredOperations: validation.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") {
      return { ok: false, error: "Re-solving minimum authority failed; this proposal is stale." };
    }

    const recompiled = compileContract({ candidatePlan: plan, validation, solverOutcome, registry });
    if (recompiled.inputHash !== contract.inputHash || recompiled.outputHash !== contract.outputHash) {
      return {
        ok: false,
        error:
          "The current registry or policies would compile this task's plan differently than when it was proposed. Propose a new contract version instead of activating this one.",
      };
    }

    const recomputedApprovals = deriveRequiredApprovals({
      candidatePlan: plan,
      validation,
      solverOutcome,
      registry,
      activePolicies,
    });
    const recomputedApprovalsHash = canonicalHash({ schemaVersion: 1, items: recomputedApprovals });
    const persistedApprovalsHash = canonicalHash({ schemaVersion: 1, items: contract.requiredApprovalsSpec });
    if (recomputedApprovalsHash !== persistedApprovalsHash) {
      return {
        ok: false,
        error:
          "Current policy would require different approvals than this contract has on file. Propose a new contract version instead of activating this one.",
      };
    }

    const verification = verifyCompiledContract({
      candidatePlan: plan,
      registry,
      activePolicies,
      compiled: recompiled,
      narrowedValidation: validation,
      tenantId: identity.tenant.tenantId,
      taskId,
      maxAllowedExpirySeconds: 24 * 3600,
      supportedRegistryVersions,
      supportedCompilerVersions,
    });
    if (!verification.ok) {
      const firstFailure = verification.checks.find((c) => !c.passed);
      return { ok: false, error: `Re-verification failed: ${firstFailure?.detail ?? "unknown check"}` };
    }

    await callActivateTaskContract(context, contractId);

    revalidatePath(`/app/tasks/${taskId}`);
    revalidatePath("/app");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function revokeContractAction(
  taskId: string,
  contractId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
    await callRevokeTaskContract(context, contractId, reason);
    revalidatePath(`/app/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

const RAISE_BUDGET_MESSAGES: Record<string, string> = {
  forbidden: "Only admins and owners can renew a task's budgets.",
  not_found: "Task not found.",
  no_active_contract: "This task has no active contract to renew budgets for.",
  invalid_request: "The note must be at most 500 characters.",
};

/**
 * Renews the task-wide budgets for the task's active contract: each action's task-wide allowance becomes what the task
 * has used plus that contract's maxInvocations. The contract's own per-version limits still apply, so a contract that
 * has spent them needs a re-prepare to use the raise. Recorded with the person and note. The database checks the
 * role; this is only the trigger.
 */
export async function raiseTaskBudgetsAction(taskId: string, note: string): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
    const status = await callRaiseTaskBudgets(context, taskId, note.trim());
    if (status !== "ok")
      return { ok: false, error: RAISE_BUDGET_MESSAGES[status] ?? "Could not renew budgets." };
    revalidatePath(`/app/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}
