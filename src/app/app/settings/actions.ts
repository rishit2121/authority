"use server";

import { revalidatePath } from "next/cache";

import { SEMANTIC_MODES, SEMANTIC_PROVIDERS } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { RISK_CLASSES } from "@/lib/semantic/enforcement-grade";

export interface SettingsActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Saves semantic-evaluation and capability settings via
 * `set_semantic_settings_v2()`, which re-checks the caller's role and enforces
 * every enforcement rule in the database (admin-only, explicit approval of the
 * exact provider and model, and an enforcement-grade provider for the tenant's
 * environment). Nothing secret is accepted or stored here: provider keys live
 * only in the server environment.
 */
export async function updateSemanticSettingsAction(input: {
  mode: string;
  provider: string;
  model: string;
  timeoutMs: number;
  requiredClasses: string[];
  capabilityTtlSeconds: number;
  approveEnforcement: boolean;
}): Promise<SettingsActionResult> {
  if (!(SEMANTIC_MODES as readonly string[]).includes(input.mode))
    return { ok: false, error: "Unknown mode." };
  if (!(SEMANTIC_PROVIDERS as readonly string[]).includes(input.provider))
    return { ok: false, error: "Unknown provider." };
  if (!Number.isInteger(input.timeoutMs))
    return { ok: false, error: "Timeout must be a whole number of milliseconds." };
  if (!Number.isInteger(input.capabilityTtlSeconds)) {
    return { ok: false, error: "Capability lifetime must be a whole number of seconds." };
  }
  if (!input.requiredClasses.every((c) => (RISK_CLASSES as readonly string[]).includes(c))) {
    return { ok: false, error: "Unknown risk class." };
  }

  try {
    const { context, identity } = await createRepositoriesForCurrentTenant("/app/settings");
    const { error } = await context.supabase.rpc("set_semantic_settings_v2", {
      p_tenant_id: identity.tenant.tenantId,
      p_mode: input.mode as "off" | "shadow" | "enforce",
      p_provider: input.provider,
      p_model: input.model.trim(),
      p_timeout_ms: input.timeoutMs,
      p_required_classes: input.requiredClasses,
      p_capability_ttl_seconds: input.capabilityTtlSeconds,
      p_approve_enforcement: input.approveEnforcement,
    });
    if (error) {
      if (error.code === "42501")
        return { ok: false, error: "You do not have permission to change these settings." };
      if (error.code === "0A000") {
        return {
          ok: false,
          error:
            "Enforcement needs an enforcement-grade provider for this workspace's environment and your explicit approval of this provider and model.",
        };
      }
      if (error.code === "23514")
        return { ok: false, error: "A value is out of range (timeout 100–5000 ms, lifetime 5–900 s)." };
      return { ok: false, error: "Settings could not be saved." };
    }
    revalidatePath("/app/settings");
    return { ok: true };
  } catch {
    return { ok: false, error: "Settings could not be saved." };
  }
}

export async function setRetentionAction(days: number): Promise<SettingsActionResult> {
  if (!Number.isInteger(days) || days < 7 || days > 365)
    return { ok: false, error: "Retention must be a whole number of days between 7 and 365." };
  try {
    const { identity, context } = await createRepositoriesForCurrentTenant("/app/settings");
    const { error } = await context.supabase.rpc("set_retention_settings", {
      p_tenant_id: identity.tenant.tenantId,
      p_validation_days: days,
    });
    if (error) {
      if (error.code === "42501") return { ok: false, error: "Only admins and owners can change retention." };
      return { ok: false, error: "Retention could not be saved." };
    }
    revalidatePath("/app/settings");
    return { ok: true };
  } catch {
    return { ok: false, error: "Retention could not be saved." };
  }
}
