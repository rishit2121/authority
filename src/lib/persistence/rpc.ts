import type { Json } from "@/lib/supabase/database.types";

import type { RepositoryContext } from "./context";
import { throwDatabaseError } from "./errors";

/**
 * Typed wrappers over the SECURITY DEFINER RPCs — the only write paths that
 * exist for tasks, capabilities, decisions and demo data in this phase. Each
 * one runs the caller's own real session through `context.supabase.rpc()`,
 * so the RPC's own membership/role checks apply exactly as they do for any
 * other client — nothing here elevates privilege or bypasses them.
 *
 * These live outside `AuthorityRepositories`: they are commands, not reads,
 * and the domain's repository interfaces are deliberately read-only in this
 * phase (see repositories.ts). Server Actions call these directly.
 */

export interface CreateTaskInput {
  agentId: string;
  principalId: string;
  trustedObjective: string;
  provenance: string;
  idempotencyKey?: string;
}

export interface CreateTaskResult {
  taskId: string;
  wasCreated: boolean;
}

export async function callCreateTask(
  context: RepositoryContext,
  input: CreateTaskInput,
): Promise<CreateTaskResult> {
  const { data, error } = await context.supabase.rpc("create_task", {
    p_tenant_id: context.tenantId,
    p_agent_id: input.agentId,
    p_principal_id: input.principalId,
    p_trusted_objective: input.trustedObjective,
    p_provenance: input.provenance,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) throwDatabaseError("create task", error);

  const row = data?.[0];
  if (!row) throwDatabaseError("create task", { code: "no_rows_returned" });

  return { taskId: row.task_id, wasCreated: row.was_created };
}

/**
 * Terminates a task via `terminate_task()`. The RPC itself derives the
 * task's tenant from the row and re-verifies the caller's role against it —
 * `context.tenantId` is not passed, because the RPC's own signature takes
 * only a task id and is not supposed to trust a tenant claim about a task it
 * can look up directly.
 */
export async function callTerminateTask(context: RepositoryContext, taskId: string): Promise<void> {
  const { error } = await context.supabase.rpc("terminate_task", { p_task_id: taskId });
  if (error) throwDatabaseError("terminate task", error);
}

export interface InstallDemoWorkspaceResult {
  wasInstalled: boolean;
}

export async function callInstallDemoWorkspace(
  context: RepositoryContext,
): Promise<InstallDemoWorkspaceResult> {
  const { data, error } = await context.supabase.rpc("install_demo_workspace", {
    p_tenant_id: context.tenantId,
  });

  if (error) throwDatabaseError("install demo workspace", error);

  const row = data?.[0];
  return { wasInstalled: row?.was_installed ?? false };
}

export async function callResetDemoWorkspace(context: RepositoryContext): Promise<void> {
  const { error } = await context.supabase.rpc("reset_demo_workspace", {
    p_tenant_id: context.tenantId,
  });

  if (error) throwDatabaseError("reset demo workspace", error);
}

/**
 * Part 3A: the candidate-plan and contract-lifecycle RPCs. Each one runs
 * server-side TypeScript validation/solving/compilation first (see
 * lib/authorization/) and passes only the *result* here — the database
 * independently re-verifies tenancy, role and structural integrity, never
 * the TypeScript pipeline's own claims about correctness. See the module
 * doc on lib/authorization/contract-verifier.ts for what that split does
 * and does not prove.
 */

export interface CreateCandidatePlanNodeInput {
  id: string;
  sequence: number;
  tool: string;
  arguments: Record<string, string | number | boolean | string[]>;
  resourceBinding?: string;
  dependencies: string[];
  declaredOutputs: string[];
  dataFlowRefs: { argumentKey: string; fromNodeId: string; output: string }[];
  agentGenerated?: string[];
  maxInvocations: number;
  validationStatus: "pending" | "accepted" | "requires_review" | "clarify" | "replan" | "denied";
  expectedSideEffect: "read" | "write_create" | "write_update" | "write_delete" | "admin";
}

export interface CreateCandidatePlanInput {
  taskId: string;
  nodes: CreateCandidatePlanNodeInput[];
  inputHash: string;
  idempotencyKey?: string;
}

export interface CreateCandidatePlanResult {
  planId: string;
  version: number;
  wasCreated: boolean;
}

export async function callCreateCandidatePlan(
  context: RepositoryContext,
  input: CreateCandidatePlanInput,
): Promise<CreateCandidatePlanResult> {
  const nodes = input.nodes.map((n) => ({
    id: n.id,
    sequence: n.sequence,
    tool: n.tool,
    arguments: n.arguments,
    resource_binding: n.resourceBinding ?? null,
    dependencies: n.dependencies,
    declared_outputs: n.declaredOutputs,
    data_flow_refs: n.dataFlowRefs,
    agent_generated: n.agentGenerated ?? [],
    max_invocations: n.maxInvocations,
    validation_status: n.validationStatus,
    expected_effect: n.expectedSideEffect,
  }));

  const { data, error } = await context.supabase.rpc("create_candidate_plan", {
    p_task_id: input.taskId,
    p_nodes: nodes,
    p_input_hash: input.inputHash,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) throwDatabaseError("create candidate plan", error);

  const row = data?.[0];
  if (!row) throwDatabaseError("create candidate plan", { code: "no_rows_returned" });

  return { planId: row.plan_id, version: row.version, wasCreated: row.was_created };
}

export interface ProposeTaskContractInput {
  taskId: string;
  planId: string;
  allowedActions: Json;
  forbiddenResources: string[];
  forbiddenOperations: string[];
  ephemeralLimits: Json;
  dataFlowBindings: Json;
  requiredApprovals: Json;
  requiredApprovalsSpec: Json;
  registryVersion: string;
  compilerVersion: string;
  inputHash: string;
  outputHash: string;
  verifierResult: Json;
  objectiveTrace: Json;
}

export interface ProposeTaskContractResult {
  contractId: string;
  version: number;
  wasCreated: boolean;
}

export async function callProposeTaskContract(
  context: RepositoryContext,
  input: ProposeTaskContractInput,
): Promise<ProposeTaskContractResult> {
  const { data, error } = await context.supabase.rpc("propose_task_contract", {
    p_task_id: input.taskId,
    p_plan_id: input.planId,
    p_allowed_actions: input.allowedActions,
    p_forbidden_resources: input.forbiddenResources,
    p_forbidden_operations: input.forbiddenOperations,
    p_ephemeral_limits: input.ephemeralLimits,
    p_data_flow_bindings: input.dataFlowBindings,
    p_required_approvals: input.requiredApprovals,
    p_required_approvals_spec: input.requiredApprovalsSpec,
    p_registry_version: input.registryVersion,
    p_compiler_version: input.compilerVersion,
    p_input_hash: input.inputHash,
    p_output_hash: input.outputHash,
    p_verifier_result: input.verifierResult,
    p_objective_trace: input.objectiveTrace,
  });

  if (error) throwDatabaseError("propose task contract", error);

  const row = data?.[0];
  if (!row) throwDatabaseError("propose task contract", { code: "no_rows_returned" });

  return { contractId: row.contract_id, version: row.version, wasCreated: row.was_created };
}

export async function callSubmitContractForApproval(
  context: RepositoryContext,
  contractId: string,
): Promise<void> {
  const { error } = await context.supabase.rpc("submit_contract_for_approval", { p_contract_id: contractId });
  if (error) throwDatabaseError("submit contract for approval", error);
}

export async function callRejectContract(
  context: RepositoryContext,
  contractId: string,
  reason: string,
): Promise<void> {
  const { error } = await context.supabase.rpc("reject_contract", {
    p_contract_id: contractId,
    p_reason: reason,
  });
  if (error) throwDatabaseError("reject contract", error);
}

/**
 * Approves or rejects one pending contract-bound approval slot. The RPC
 * independently re-derives eligibility (role/kind match, self-approval
 * prevention, distinct-approver-per-tier) from the approval row and the
 * contract itself — nothing here is trusted from the caller beyond which
 * approval and which decision.
 */
export async function callDecideContractApproval(
  context: RepositoryContext,
  approvalId: string,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  const { error } = await context.supabase.rpc("decide_contract_approval", {
    p_approval_id: approvalId,
    p_decision: decision,
    p_reason: reason,
  });
  if (error) throwDatabaseError("decide contract approval", error);
}

/**
 * The one path into contract_status = 'active'. Callers must have already
 * re-run the full validate/solve/compile/verify pipeline against the
 * *current* registry and policies and confirmed a byte-identical output
 * hash before ever calling this — see the activation server action's
 * module doc. This RPC has no way to confirm that happened; it only
 * enforces what a database can mechanically check (see contract-
 * activation-rpcs.sql's own module doc for the exact trust boundary).
 */
export async function callActivateTaskContract(
  context: RepositoryContext,
  contractId: string,
): Promise<void> {
  const { error } = await context.supabase.rpc("activate_task_contract", { p_contract_id: contractId });
  if (error) throwDatabaseError("activate task contract", error);
}

/**
 * A person renews the task-wide budgets of the task's active contract (20261027000001). Admins and owners only; the
 * database enforces the role. Returns "ok", "forbidden", "not_found", "no_active_contract" or "invalid_request".
 */
export async function callRaiseTaskBudgets(
  context: RepositoryContext,
  taskId: string,
  note: string,
): Promise<string> {
  const { data, error } = await context.supabase.rpc("raise_task_budgets", {
    p_task_id: taskId,
    p_note: note,
  });
  if (error) throwDatabaseError("raise task budgets", error);
  return data as string;
}

export async function callRevokeTaskContract(
  context: RepositoryContext,
  contractId: string,
  reason: string,
): Promise<void> {
  const { error } = await context.supabase.rpc("revoke_task_contract", {
    p_contract_id: contractId,
    p_reason: reason,
  });
  if (error) throwDatabaseError("revoke task contract", error);
}

/**
 * Belt, not suspenders — see authz.contract_is_currently_active() and
 * lib/authorization/contract-runtime.ts's isContractCurrentlyActive(),
 * which any real check must call instead of trusting contract_status alone.
 * Returns how many contracts this call itself flipped to 'expired'.
 */
export async function callReconcileExpiredContracts(context: RepositoryContext): Promise<number> {
  const { data, error } = await context.supabase.rpc("reconcile_expired_contracts");
  if (error) throwDatabaseError("reconcile expired contracts", error);
  return data ?? 0;
}
