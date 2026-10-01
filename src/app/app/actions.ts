"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { throwDatabaseError, RepositoryError } from "@/lib/persistence/errors";
import { resolveApprovalToUpdateRow } from "@/lib/persistence/mappers/approval";
import {
  callCreateTask,
  callInstallDemoWorkspace,
  callResetDemoWorkspace,
  callTerminateTask,
} from "@/lib/persistence/rpc";

/**
 * Server actions for the product pages.
 *
 * Every one of these calls `createRepositoriesForCurrentTenant()` first,
 * which independently re-verifies the user and resolves their real tenant —
 * none of these actions accepts a tenant id from its caller, so there is
 * nothing for a form or client script to forge. Errors are reduced to a
 * small closed set of safe messages; a raw `RepositoryError` (which itself
 * never carries a raw Supabase message — see lib/persistence/errors.ts) is
 * never returned to the client as-is.
 */

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function presentActionError(error: unknown): string {
  if (error instanceof RepositoryError) {
    switch (error.code) {
      case "tenant_mismatch":
        return "That action doesn't apply to your current workspace.";
      case "not_found":
        return "That record could not be found.";
      case "invalid_row":
      case "database_error":
      default:
        return "Something went wrong. Please try again.";
    }
  }

  // Postgres/PostgREST errors surfaced through the RPC wrappers carry a
  // `.code`; 42501 is the one meaningful distinction worth naming, since it
  // reflects a real authorization boundary rather than a transient failure.
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "42501") return "You don't have permission to do that.";
  }

  return "Something went wrong. Please try again.";
}

const objectiveSchema = z.string().trim().min(1, "Enter a trusted objective.").max(4000);

const agentNameSchema = z.string().trim().min(1, "Enter a name.").max(200);
const agentFieldSchema = z.string().trim().min(1, "This field is required.").max(200);

export interface CreateAgentFormState extends ActionResult<{ agentId: string }> {
  fieldErrors?: Partial<
    Record<"name" | "model" | "modelProvider" | "framework" | "ownerPrincipalId", string>
  >;
}

/**
 * Inserts directly into `agents`, relying entirely on
 * `agents_insert_by_developer_and_above` (20260923000008_product_rls.sql) as
 * the real authorization boundary — this action performs no role check of
 * its own, the same division of responsibility `resolveApprovalAction` below
 * uses for its own direct table write.
 */
export async function createAgentAction(
  _previous: CreateAgentFormState,
  formData: FormData,
): Promise<CreateAgentFormState> {
  const name = String(formData.get("name") ?? "");
  const model = String(formData.get("model") ?? "");
  const modelProvider = String(formData.get("modelProvider") ?? "");
  const framework = String(formData.get("framework") ?? "");
  const ownerPrincipalId = String(formData.get("ownerPrincipalId") ?? "");

  const nameResult = agentNameSchema.safeParse(name);
  const modelResult = agentFieldSchema.safeParse(model);
  const providerResult = agentFieldSchema.safeParse(modelProvider);
  const frameworkResult = agentFieldSchema.safeParse(framework);

  const fieldErrors: CreateAgentFormState["fieldErrors"] = {};
  if (!nameResult.success) fieldErrors.name = nameResult.error.issues[0]?.message ?? "Enter a name.";
  if (!modelResult.success) fieldErrors.model = "Enter a model.";
  if (!providerResult.success) fieldErrors.modelProvider = "Enter a model provider.";
  if (!frameworkResult.success) fieldErrors.framework = "Enter a framework.";
  if (!ownerPrincipalId) fieldErrors.ownerPrincipalId = "Choose an owner.";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  try {
    const { context, identity } = await createRepositoriesForCurrentTenant("/app/agents/new");

    const { data, error } = await context.supabase
      .from("agents")
      .insert({
        tenant_id: identity.tenant.tenantId,
        name: nameResult.data ?? name.trim(),
        model: modelResult.data ?? model.trim(),
        model_provider: providerResult.data ?? modelProvider.trim(),
        framework: frameworkResult.data ?? framework.trim(),
        owner_principal_id: ownerPrincipalId,
      })
      .select("id")
      .single();

    if (error) throwDatabaseError("register agent", error);

    revalidatePath("/app/agents");
    revalidatePath("/app");
    return { ok: true, data: { agentId: data.id } };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

const policyEffectSchema = z.enum(["allow", "deny", "require_approval"]);

export interface CreatePolicyFormState extends ActionResult<{ policyId: string }> {
  fieldErrors?: Partial<Record<"name" | "effect", string>>;
}

/**
 * Inserts a `draft` policy directly, relying on
 * `policies_insert_by_security_admin_and_above` (20260923000008_product_rls.sql)
 * as the real authorization boundary. A draft has no enforcement effect at
 * all — see policy.ts's domain comment — so this action creates no new live
 * constraint; activating a draft remains a later phase, not built here.
 */
export async function createPolicyAction(
  _previous: CreatePolicyFormState,
  formData: FormData,
): Promise<CreatePolicyFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const effectInput = String(formData.get("effect") ?? "");
  const conditionKey = String(formData.get("conditionKey") ?? "").trim();
  const conditionMatches = String(formData.get("conditionMatches") ?? "").trim();

  const effectResult = policyEffectSchema.safeParse(effectInput);

  const fieldErrors: CreatePolicyFormState["fieldErrors"] = {};
  if (!name) fieldErrors.name = "Enter a name.";
  if (!effectResult.success) fieldErrors.effect = "Choose an effect.";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  try {
    const { context, identity } = await createRepositoriesForCurrentTenant("/app/policies/new");

    const conditions =
      conditionKey && conditionMatches ? [{ key: conditionKey, matches: conditionMatches }] : [];

    const { data, error } = await context.supabase
      .from("policies")
      .insert({
        tenant_id: identity.tenant.tenantId,
        name,
        description: description || null,
        effect: effectInput as "allow" | "deny" | "require_approval",
        conditions,
        status: "draft",
      })
      .select("id")
      .single();

    if (error) throwDatabaseError("create policy", error);

    revalidatePath("/app/policies");
    return { ok: true, data: { policyId: data.id } };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function installDemoWorkspaceAction(): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant("/app");
    await callInstallDemoWorkspace(context);
    revalidatePath("/app");
    revalidatePath("/app/tasks");
    revalidatePath("/app/agents");
    revalidatePath("/app/policies");
    revalidatePath("/app/integrations");
    revalidatePath("/app/approvals");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function resetDemoWorkspaceAction(): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant("/app");
    await callResetDemoWorkspace(context);
    revalidatePath("/app");
    revalidatePath("/app/tasks");
    revalidatePath("/app/agents");
    revalidatePath("/app/policies");
    revalidatePath("/app/integrations");
    revalidatePath("/app/approvals");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function terminateTaskAction(taskId: string): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
    await callTerminateTask(context, taskId);
    revalidatePath(`/app/tasks/${taskId}`);
    revalidatePath("/app");
    revalidatePath("/app/tasks");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export interface CreateTaskFormState extends ActionResult<{ taskId: string }> {
  fieldErrors?: Partial<Record<"agentId" | "principalId" | "objective", string>>;
}

export async function createTaskAction(
  _previous: CreateTaskFormState,
  formData: FormData,
): Promise<CreateTaskFormState> {
  const agentId = String(formData.get("agentId") ?? "");
  const principalId = String(formData.get("principalId") ?? "");
  const provenance = String(formData.get("provenance") ?? "app_form");
  const objectiveInput = String(formData.get("objective") ?? "");

  const objectiveResult = objectiveSchema.safeParse(objectiveInput);

  const fieldErrors: CreateTaskFormState["fieldErrors"] = {};
  if (!agentId) fieldErrors.agentId = "Choose an agent.";
  if (!principalId) fieldErrors.principalId = "Choose a principal.";
  if (!objectiveResult.success) {
    fieldErrors.objective = objectiveResult.error.issues[0]?.message ?? "Enter a trusted objective.";
  }

  if (!objectiveResult.success || !agentId || !principalId) {
    return { ok: false, fieldErrors };
  }

  try {
    const { context } = await createRepositoriesForCurrentTenant("/app/tasks/new");
    const result = await callCreateTask(context, {
      agentId,
      principalId,
      trustedObjective: objectiveResult.data,
      provenance,
    });
    revalidatePath("/app");
    revalidatePath("/app/tasks");
    return { ok: true, data: { taskId: result.taskId } };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

const resolveApprovalDecisionSchema = z.enum(["approved", "rejected"]);

/**
 * Resolves a pending approval. The write path is a direct, RLS-gated
 * UPDATE — security_admin+ is enforced by
 * `approvals_update_by_security_admin_and_above` (see
 * 20260923000008_product_rls.sql), not by anything checked here; this
 * action does not attempt its own privilege check because RLS is the
 * actual boundary. The `.eq("status", "pending")` filter makes a repeated
 * resolution idempotent — it matches zero rows rather than raising.
 *
 * Resolving an approval only records the human decision. It mints no
 * capability and triggers no execution of any kind.
 */
export async function resolveApprovalAction(
  approvalId: string,
  decision: string,
  reason: string,
): Promise<ActionResult> {
  const decisionResult = resolveApprovalDecisionSchema.safeParse(decision);
  if (!decisionResult.success) {
    return { ok: false, error: "That isn't a valid decision." };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length > 2000) {
    return { ok: false, error: "The reason is too long." };
  }

  try {
    const { context, identity } = await createRepositoriesForCurrentTenant("/app/approvals");

    // Best-effort: an authenticated app user has no guaranteed principal row
    // yet (see the mapper's own comment). When one exists for this user in
    // this tenant, the decision records who made it; when none does, the
    // decision is still recorded, just without that attribution.
    const { data: matchingPrincipal } = await context.supabase
      .from("principals")
      .select("id")
      .eq("tenant_id", identity.tenant.tenantId)
      .eq("user_id", identity.userId)
      .maybeSingle();

    const updateRow = resolveApprovalToUpdateRow({
      status: decisionResult.data,
      responseNote: trimmedReason || undefined,
      respondedByPrincipalId: matchingPrincipal?.id,
    });

    const { data, error } = await context.supabase
      .from("approvals")
      .update(updateRow)
      .eq("id", approvalId)
      .eq("status", "pending")
      .select("id");

    if (error) throwDatabaseError("resolve approval", error);

    if (!data || data.length === 0) {
      return {
        ok: false,
        error: "That approval was already resolved, or you don't have permission to resolve it.",
      };
    }

    revalidatePath("/app/approvals");
    revalidatePath("/app");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}
