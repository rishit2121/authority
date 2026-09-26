"use server";

import { revalidatePath } from "next/cache";

import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export async function revokeCapabilityAction(
  capabilityId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(capabilityId)) return { ok: false, error: "Invalid capability." };
  if (reason.trim().length === 0 || reason.length > 500)
    return { ok: false, error: "A reason of 1–500 characters is required." };
  try {
    const { context } = await createRepositoriesForCurrentTenant("/app/runtime");
    const { error } = await context.supabase.rpc("revoke_capability", {
      p_capability_id: capabilityId,
      p_reason: reason.trim(),
    });
    if (error) {
      if (error.code === "42501")
        return { ok: false, error: "Only security admins and above can revoke capabilities." };
      return { ok: false, error: "The capability could not be revoked." };
    }
    revalidatePath("/app/runtime");
    return { ok: true };
  } catch {
    return { ok: false, error: "The capability could not be revoked." };
  }
}
