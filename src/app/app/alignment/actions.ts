"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

/**
 * Dashboard actions for task alignment. Every one goes through a
 * SECURITY DEFINER RPC that re-checks the caller's role (security_admin and
 * above); nothing here trusts the browser for authorization.
 */

export interface AlignmentActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const MESSAGES: Record<string, string> = {
  forbidden: "Only security admins and above can do that.",
  not_found: "That record could not be found.",
  invalid_request: "That request isn't valid.",
  already_decided: "Someone already decided this.",
  not_required: "This review passed; there is nothing to approve.",
};

export async function setAlignmentSettingsAction(
  applicationId: string,
  mode: string,
  policy: string,
): Promise<AlignmentActionResult> {
  const parsed = z
    .object({
      applicationId: z.string().uuid(),
      mode: z.enum(["off", "shadow", "enforce"]),
      policy: z.enum(["reference", "production"]),
    })
    .safeParse({ applicationId, mode, policy });
  if (!parsed.success) return { ok: false, error: MESSAGES.invalid_request };
  try {
    const { context } = await createRepositoriesForCurrentTenant(
      `/app/settings/applications/${applicationId}`,
    );
    const { data, error } = await context.supabase.rpc("set_alignment_settings", {
      p_application_id: applicationId,
      p_mode: mode,
      p_policy: policy,
    });
    if (error) return { ok: false, error: "Could not save." };
    if (data !== "ok") return { ok: false, error: MESSAGES[data as string] ?? "Could not save." };
    revalidatePath(`/app/settings/applications/${applicationId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save." };
  }
}

export async function setAlignmentChecksAction(
  applicationId: string,
  checks: { plans: boolean; content: boolean; actions: boolean; contentAction: "report" | "quarantine" },
): Promise<AlignmentActionResult> {
  if (!z.string().uuid().safeParse(applicationId).success)
    return { ok: false, error: MESSAGES.invalid_request };
  try {
    const { context } = await createRepositoriesForCurrentTenant(
      `/app/settings/applications/${applicationId}`,
    );
    const { data, error } = await context.supabase.rpc("set_alignment_checks", {
      p_application_id: applicationId,
      p_check_plans: checks.plans,
      p_check_content: checks.content,
      p_check_actions: checks.actions,
    });
    if (error) return { ok: false, error: "Could not save." };
    if (data !== "ok") return { ok: false, error: MESSAGES[data as string] ?? "Could not save." };
    const screening = await context.supabase.rpc("set_alignment_content_screening", {
      p_application_id: applicationId,
      p_enabled: checks.content,
      p_action: checks.contentAction,
    });
    if (screening.error || screening.data !== "ok")
      return { ok: false, error: "Could not save content screening." };
    revalidatePath(`/app/settings/applications/${applicationId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save." };
  }
}

export async function setRequireTaskSessionsAction(
  applicationId: string,
  required: boolean,
): Promise<AlignmentActionResult> {
  if (!z.string().uuid().safeParse(applicationId).success)
    return { ok: false, error: MESSAGES.invalid_request };
  try {
    const { context } = await createRepositoriesForCurrentTenant(
      `/app/settings/applications/${applicationId}`,
    );
    const { data, error } = await context.supabase.rpc("set_application_require_task_sessions", {
      p_application_id: applicationId,
      p_required: required,
    });
    if (error) return { ok: false, error: "Could not save." };
    if (data !== "ok") return { ok: false, error: MESSAGES[data as string] ?? "Could not save." };
    revalidatePath(`/app/settings/applications/${applicationId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save." };
  }
}

export async function decideAlignmentReviewAction(
  taskId: string,
  reviewId: string,
  decision: "approved" | "rejected",
  note: string,
): Promise<AlignmentActionResult> {
  if (!z.string().uuid().safeParse(reviewId).success || !["approved", "rejected"].includes(decision)) {
    return { ok: false, error: MESSAGES.invalid_request };
  }
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
    const { data, error } = await context.supabase.rpc("decide_alignment_review", {
      p_review_id: reviewId,
      p_decision: decision,
      p_note: note.slice(0, 1000),
    });
    if (error) return { ok: false, error: "Could not record the decision." };
    if (data !== "ok")
      return { ok: false, error: MESSAGES[data as string] ?? "Could not record the decision." };
    revalidatePath(`/app/tasks/${taskId}`);
    revalidatePath("/app/approvals");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not record the decision." };
  }
}

/** The original held/quarantined text, for reviewers; each reveal is recorded on the item. */
export async function revealExternalContentAction(
  taskId: string,
  itemId: string,
): Promise<AlignmentActionResult<string | null>> {
  if (!z.string().uuid().safeParse(itemId).success) return { ok: false, error: MESSAGES.invalid_request };
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);
    const { data, error } = await context.supabase.rpc("reveal_external_content", { p_item_id: itemId });
    if (error)
      return {
        ok: false,
        error: error.code === "42501" ? MESSAGES.forbidden : "Could not load the content.",
      };
    return { ok: true, data: (data as string | null) ?? null };
  } catch {
    return { ok: false, error: "Could not load the content." };
  }
}
