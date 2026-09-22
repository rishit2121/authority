"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

import { getVerifiedUser } from "./identity";
import {
  TENANT_COOKIE_NAME,
  TENANT_COOKIE_OPTIONS,
  validateWorkspaceSelection,
  type TenantMembership,
} from "./tenant-context";

/**
 * Workspace switching.
 *
 * The cookie is written only after the requested tenant is confirmed to be one
 * of the caller's own memberships, read fresh from the database under RLS. The
 * cookie therefore records a choice among things already permitted; it never
 * widens what the user can see. Even if it were forged, `resolveCurrentTenant`
 * re-checks membership on every request and ignores anything unrecognized.
 */

export interface SwitchWorkspaceResult {
  ok: boolean;
  error?: string;
}

export async function switchWorkspaceAction(tenantId: string): Promise<SwitchWorkspaceResult> {
  const supabase = await createClient();
  const user = await getVerifiedUser(supabase);

  if (!user) {
    return { ok: false, error: "Your session expired. Sign in again." };
  }

  // Filtered to this user for the same reason as in identity.ts: the
  // memberships policy exposes co-members of an accessible tenant, so an
  // unfiltered read would validate the switch against other people's rows.
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, tenants!inner(id, name, slug, environment)")
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, error: "Could not load your workspaces. Try again." };
  }

  const memberships: TenantMembership[] = (data ?? []).map((row) => ({
    tenantId: row.tenants.id,
    name: row.tenants.name,
    slug: row.tenants.slug,
    environment: row.tenants.environment,
    role: row.role,
  }));

  const validated = validateWorkspaceSelection(memberships, tenantId);

  if (!validated.ok) {
    // Same message for a malformed id and a tenant the user does not belong
    // to: a distinct "no such workspace" would confirm that some other
    // workspace exists.
    return { ok: false, error: "That workspace isn't available to you." };
  }

  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE_NAME, validated.tenantId, {
    ...TENANT_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === "production",
  });

  revalidatePath("/app");

  return { ok: true };
}
