"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { canonicalHash } from "@/lib/authorization/canonicalize";
import { compileContract } from "@/lib/authorization/contract-compiler";
import { verifyCompiledContract } from "@/lib/authorization/contract-verifier";
import {
  PlanStructureError,
  validateCandidatePlan,
  type PlanValidationResult,
} from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import { candidatePlanSchema, type CandidatePlan } from "@/lib/domain";
import {
  callCreateCandidatePlan,
  callProposeTaskContract,
  callRejectContract,
  callSubmitContractForApproval,
  type CreateCandidatePlanNodeInput,
} from "@/lib/persistence/rpc";
import type { Json } from "@/lib/supabase/database.types";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { RepositoryError } from "@/lib/persistence/errors";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

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

const registry = loadRegistry(githubDemoRegistry);

async function loadActivePolicies(taskId: string) {
  const { repositories, identity } = await createRepositoriesForCurrentTenant(
    `/app/tasks/${taskId}/contract/new`,
  );
  const allPolicies = await repositories.policies.listByTenant(identity.tenant.tenantId);
  return allPolicies.filter((p) => p.status === "active");
}

export interface ValidatePlanResult {
  findings: PlanValidationResult["findings"];
  acceptedNodeIds: string[];
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
    const activePolicies = await loadActivePolicies(taskId);
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
        requiredOperations: validation.requiredOperations,
      },
    };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export interface ProposeContractPreview {
  contractId: string;
  version: number;
  wasCreated: boolean;
  selectedPermissionIds: string[];
  excessOperations: string[];
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
    const allPolicies = await repositories.policies.listByTenant(identity.tenant.tenantId);
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

    const validation = validateCandidatePlan(plan, { registry, activePolicies });
    if (validation.acceptedNodeIds.length === 0) {
      return { ok: false, error: "No plan node was accepted — there is nothing to compile a contract from." };
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

    const verification = verifyCompiledContract({
      candidatePlan: plan,
      registry,
      activePolicies,
      compiled,
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
      };
    });

    const inputHash = canonicalHash({
      schemaVersion: plan.schemaVersion,
      taskId: plan.taskId,
      registryVersion: registry.registryVersion,
      acceptedNodes: plan.nodes
        .filter((n) => validation.acceptedNodeIds.includes(n.id))
        .sort((a, b) => a.sequence - b.sequence),
    });

    const planResult = await callCreateCandidatePlan(context, {
      taskId,
      nodes: planNodesInput,
      inputHash,
      idempotencyKey,
    });

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
