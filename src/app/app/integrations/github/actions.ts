"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { bindTaskRepository, resolveIndeterminate, setRepositoryAllowed } from "@/lib/gateway/rpc-github";
import {
  COOKIE_MAX_AGE_SECONDS,
  disconnect,
  PKCE_COOKIE,
  refreshInstallation,
  startInstall,
  STATE_COOKIE,
} from "@/lib/github/installation";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { safeLog } from "@/lib/semantic/scrub";

export interface GithubActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const PAGE = "/app/integrations/github";

const FRIENDLY: Record<string, string> = {
  forbidden: "Your role does not allow this. An admin or owner is required.",
  not_found: "That record was not found.",
  not_allowable:
    "That repository cannot be allowed right now (removed, archived, or the installation is unhealthy).",
  repository_not_allowed: "That repository is not on this workspace's allowlist.",
  already_bound: "This task is already bound to a repository. A binding cannot be changed.",
  task_closed: "This task is closed.",
  task_not_found: "Task not found.",
  installation_unavailable: "The GitHub installation is not available.",
};
const friendly = (code: string) => FRIENDLY[code] ?? "The request could not be completed.";

/** Starts the GitHub App installation: sets the single-use state cookies, then sends the browser to GitHub. */
export async function connectGithubAction(): Promise<void> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await startInstall({ tenantId: identity.tenant.tenantId, userId: identity.userId });
  if (result.status !== "ok" || !result.started)
    redirect(`${PAGE}?error=${encodeURIComponent(result.status)}`);
  const jar = await cookies();
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/github",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
  jar.set(STATE_COOKIE, result.started.nonce, options);
  jar.set(PKCE_COOKIE, result.started.verifier, options);
  redirect(result.started.installUrl);
}

export async function refreshGithubAction(
  installationRowId: string,
  githubInstallationId: string,
): Promise<GithubActionResult> {
  try {
    const { identity } = await createRepositoriesForCurrentTenant(PAGE);
    const r = await refreshInstallation({
      tenantId: identity.tenant.tenantId,
      userId: identity.userId,
      installationRowId,
      githubInstallationId,
    });
    revalidatePath(PAGE);
    if (r.status === "forbidden") return { ok: false, error: friendly("forbidden") };
    return {
      ok: true,
      message:
        r.health === "active" ? "Installation is healthy." : `Installation status: ${r.health ?? "unknown"}.`,
    };
  } catch {
    safeLog("github refresh failed");
    return { ok: false, error: "GitHub could not be reached. Try again shortly." };
  }
}

export async function disconnectGithubAction(
  installationRowId: string,
  alsoUninstall: boolean,
): Promise<GithubActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const r = await disconnect({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    installationRowId,
    alsoUninstall,
  });
  revalidatePath(PAGE);
  if (r.status !== "ok") return { ok: false, error: friendly(r.status) };
  const uninstall =
    r.uninstalled === true
      ? " and uninstalled from GitHub"
      : r.uninstalled === false
        ? " (uninstall on GitHub did not complete — remove the App there)"
        : "";
  return {
    ok: true,
    message: `Disconnected${uninstall}; ${r.revokedCapabilities} live capabilit${r.revokedCapabilities === 1 ? "y" : "ies"} revoked.`,
  };
}

export async function setRepositoryAllowedAction(
  repositoryId: string,
  allowed: boolean,
): Promise<GithubActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const status = await setRepositoryAllowed({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    repositoryId,
    allowed,
  });
  revalidatePath(PAGE);
  return status === "ok" ? { ok: true } : { ok: false, error: friendly(status) };
}

export async function bindTaskRepositoryAction(
  taskId: string,
  repositoryId: string,
): Promise<GithubActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
  const status = await bindTaskRepository({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    taskId,
    repositoryId,
  });
  revalidatePath(`/app/tasks/${taskId}`);
  return status === "ok" ? { ok: true } : { ok: false, error: friendly(status) };
}

export async function resolveIndeterminateAction(
  taskId: string,
  executionId: string,
  outcome: "executed" | "not_executed",
  note: string,
): Promise<GithubActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
  const status = await resolveIndeterminate({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    executionId,
    outcome,
    note,
  });
  revalidatePath(`/app/tasks/${taskId}`);
  if (status === "ok") return { ok: true };
  if (status === "already_resolved") return { ok: false, error: "This execution was already resolved." };
  return { ok: false, error: friendly(status) };
}

const DECISION_ERRORS: Record<string, string> = {
  "42501":
    "You cannot decide this approval: it needs a security administrator who does not own the task or agent.",
  "23505": "You have already decided this approval.",
  P0002: "Approval not found.",
};

export async function decideRuntimeApprovalAction(
  requestId: string,
  decision: "approve" | "reject",
  note: string,
): Promise<GithubActionResult> {
  const { context } = await createRepositoriesForCurrentTenant("/app/approvals");
  const { data, error } = await context.supabase.rpc("decide_runtime_approval", {
    p_request_id: requestId,
    p_decision: decision,
    p_note: note,
  });
  revalidatePath("/app/approvals");
  if (error)
    return { ok: false, error: DECISION_ERRORS[error.code ?? ""] ?? "The decision could not be recorded." };
  if (data === "stale")
    return {
      ok: false,
      error:
        "This approval is stale (the contract, policy, agent or integration changed). It cannot be granted.",
    };
  if (data === "expired") return { ok: false, error: "This approval expired." };
  return { ok: true, message: `Approval is now ${String(data)}.` };
}

export async function setRuntimeApprovalClassesAction(classes: string[]): Promise<GithubActionResult> {
  const { context, identity } = await createRepositoriesForCurrentTenant("/app/approvals");
  const { error } = await context.supabase.rpc("set_runtime_approval_classes", {
    p_tenant_id: identity.tenant.tenantId,
    p_classes: classes,
  });
  revalidatePath("/app/approvals");
  if (error)
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "Only a security administrator or above can change this."
          : "Could not save.",
    };
  return { ok: true };
}
