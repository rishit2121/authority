"use server";

import { revalidatePath } from "next/cache";

import { semanticModeSchema, SEMANTIC_PROVIDERS } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export interface SettingsActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Saves semantic-evaluation settings via `set_semantic_settings()`, which
 * re-checks the caller's role (security_admin+) and refuses `enforce` in the
 * database. Nothing secret is accepted or stored here: the provider API key
 * lives only in the server environment and is never entered through this form.
 */
export async function updateSemanticSettingsAction(input: {
  mode: string;
  provider: string;
  model: string;
  timeoutMs: number;
}): Promise<SettingsActionResult> {
  const mode = semanticModeSchema.safeParse(input.mode);
  if (!mode.success) return { ok: false, error: "Unknown mode." };
  if (mode.data === "enforce") {
    return { ok: false, error: "Semantic enforcement is unavailable until a trusted gateway exists." };
  }
  if (!(SEMANTIC_PROVIDERS as readonly string[]).includes(input.provider)) {
    return { ok: false, error: "Unknown provider." };
  }
  if (!Number.isInteger(input.timeoutMs))
    return { ok: false, error: "Timeout must be a whole number of milliseconds." };

  try {
    const { context, identity } = await createRepositoriesForCurrentTenant("/app/settings");
    const { error } = await context.supabase.rpc("set_semantic_settings", {
      p_tenant_id: identity.tenant.tenantId,
      p_mode: mode.data,
      p_provider: input.provider,
      p_model: input.model.trim(),
      p_timeout_ms: input.timeoutMs,
    });
    if (error) {
      if (error.code === "42501")
        return { ok: false, error: "Only security admins and above can change these settings." };
      if (error.code === "23514") return { ok: false, error: "That model name or timeout is out of range." };
      return { ok: false, error: "Settings could not be saved." };
    }
    revalidatePath("/app/settings");
    return { ok: true };
  } catch {
    return { ok: false, error: "Settings could not be saved." };
  }
}
