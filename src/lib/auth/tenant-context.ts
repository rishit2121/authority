import { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Tenant context resolution.
 *
 * The selected tenant is remembered in a cookie, and that cookie carries a
 * tenant identifier and nothing else — no role, no name, no capability. It is
 * a *preference*, never a grant. Every request re-derives the membership list
 * from the database under RLS and only then checks whether the remembered id
 * appears in it. A forged or stale cookie therefore selects nothing; it is
 * ignored and replaced.
 *
 * The resolution rules live in a pure function so they can be tested without
 * a database or a request.
 */

export type TenantRole = Database["public"]["Enums"]["tenant_role"];
export type TenantEnvironment = Database["public"]["Enums"]["tenant_environment"];

/** Name of the tenant-preference cookie. */
export const TENANT_COOKIE_NAME = "authority_tenant";

/**
 * Cookie options. `sameSite: "lax"` because the cookie must survive the
 * top-level navigation back from the Supabase email-confirmation link, but
 * must not ride along on cross-site subrequests. `httpOnly` because no client
 * code needs to read it — the server resolves tenancy and passes the result
 * down as props.
 */
export const TENANT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;

/** One tenant the current user actually belongs to, with their role in it. */
export interface TenantMembership {
  tenantId: string;
  name: string;
  slug: string;
  environment: TenantEnvironment;
  role: TenantRole;
}

export interface TenantResolution {
  /** The tenant to render. */
  current: TenantMembership;
  /**
   * True when the cookie disagrees with the resolved tenant and should be
   * rewritten — either it was absent, or it named something the user cannot
   * access.
   */
  shouldPersist: boolean;
}

const uuidSchema = z.string().uuid();

/**
 * Picks the tenant to render from the user's verified memberships.
 *
 * Returns null only when the user belongs to no tenant at all, which means
 * onboarding has not completed; the caller runs `ensure_onboarded()` and
 * retries rather than rendering an empty shell.
 *
 * `memberships` is assumed already ordered by the caller's query, so element
 * zero is the deterministic default and repeated requests agree.
 */
export function resolveCurrentTenant(
  memberships: readonly TenantMembership[],
  requestedTenantId: string | null | undefined,
): TenantResolution | null {
  if (memberships.length === 0) return null;

  const fallback = memberships[0];

  // A malformed cookie is not worth a lookup.
  if (typeof requestedTenantId !== "string" || !uuidSchema.safeParse(requestedTenantId).success) {
    return { current: fallback, shouldPersist: true };
  }

  const requested = memberships.find((membership) => membership.tenantId === requestedTenantId);

  // Not a membership: the cookie is stale or forged. Fall back and rewrite it,
  // rather than erroring — a user removed from a tenant should simply land in
  // one they still belong to.
  if (!requested) {
    return { current: fallback, shouldPersist: true };
  }

  return { current: requested, shouldPersist: false };
}

export type WorkspaceSelectionResult =
  { ok: true; tenantId: string } | { ok: false; reason: "malformed" | "not_a_member" };

/**
 * Validates a workspace switch before anything is written.
 *
 * Separate from `resolveCurrentTenant` on purpose: resolution is forgiving,
 * because a stale cookie should degrade quietly, whereas an explicit switch to
 * a tenant the user does not belong to is a request that must be refused and
 * not silently redirected to a different workspace.
 */
export function validateWorkspaceSelection(
  memberships: readonly TenantMembership[],
  tenantId: unknown,
): WorkspaceSelectionResult {
  if (typeof tenantId !== "string" || !uuidSchema.safeParse(tenantId).success) {
    return { ok: false, reason: "malformed" };
  }

  if (!memberships.some((membership) => membership.tenantId === tenantId)) {
    return { ok: false, reason: "not_a_member" };
  }

  return { ok: true, tenantId };
}

/** Role labels for the sidebar. Keyed exhaustively so a new role cannot slip through untitled. */
export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  owner: "Owner",
  admin: "Admin",
  security_admin: "Security admin",
  developer: "Developer",
  viewer: "Viewer",
};

export const TENANT_ENVIRONMENT_LABELS: Record<TenantEnvironment, string> = {
  development: "Development",
  staging: "Staging",
  production: "Production",
};
