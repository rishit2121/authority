"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { requireIdentity } from "@/lib/auth/identity";
import { createClient } from "@/lib/supabase/server";

/**
 * Pilot management. Each action re-verifies the owner here, and every RPC
 * re-checks the caller's verified email in auth.users itself, so neither a
 * forged form post nor a direct PostgREST call can manage the allowlist.
 */

const PAGE = "/app/pilot";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownerClient() {
  const identity = await requireIdentity(PAGE);
  if (!identity.isPilotOwner) notFound();
  return createClient();
}

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

function back(params: Record<string, string>): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

export async function updatePilotRequestAction(formData: FormData): Promise<void> {
  const supabase = await ownerClient();
  const id = text(formData, "id");
  if (!UUID.test(id)) back({ notice: "invalid" });
  const statusRaw = text(formData, "status");
  const status = ["pending", "approved", "declined"].includes(statusRaw) ? statusRaw : null;
  const notes = formData.has("notes") ? text(formData, "notes").slice(0, 4000) : null;
  const { data, error } = await supabase.rpc("pilot_admin_update", {
    p_id: id,
    p_status: status,
    p_notes: notes,
  });
  back({ id, notice: error ? "error" : String(data ?? "error") });
}

export async function addApprovedEmailAction(formData: FormData): Promise<void> {
  const supabase = await ownerClient();
  const source = text(formData, "source") === "existing_account" ? "existing_account" : "manual";
  const { data, error } = await supabase.rpc("pilot_admin_add", {
    p_email: text(formData, "email").slice(0, 254),
    p_name: text(formData, "name").slice(0, 120) || null,
    p_notes: text(formData, "notes").slice(0, 4000) || null,
    p_source: source,
  });
  back({
    notice: error ? "error" : String(data ?? "error"),
    ...(source === "existing_account" ? { tab: "accounts" } : {}),
  });
}

export async function setPilotGateAction(formData: FormData): Promise<void> {
  const supabase = await ownerClient();
  const enabled = text(formData, "enabled") === "true";
  const { data, error } = await supabase.rpc("pilot_admin_set_gate", { p_enabled: enabled });
  back({ notice: error ? "error" : String(data ?? "error") });
}
