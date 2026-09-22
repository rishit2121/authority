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
