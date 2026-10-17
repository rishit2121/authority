import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { INVITE_ONLY_PATH, loadPilotViewer } from "@/lib/pilot/viewer";
import { createClient } from "@/lib/supabase/server";

import { initialsFor } from "./display";
import { loginUrlFor } from "./redirect";
import {
  resolveCurrentTenant,
  TENANT_COOKIE_NAME,
  type TenantMembership,
  type TenantRole,
} from "./tenant-context";

/**
 * Server-side identity loading for protected surfaces.
 *
 * The middleware gate is a convenience, not the authorization boundary. It can
 * be bypassed by any request shape its matcher does not cover, so every
 * protected page re-verifies identity here. Client-side guards are not used at
 * all: nothing in `/app` renders on trust from the browser.
 */

export interface AuthorityIdentity {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  /** The tenant being viewed, and the caller's role in it. */
  tenant: TenantMembership;
  role: TenantRole;
  /** Every tenant the caller belongs to, for the workspace selector. */
  memberships: TenantMembership[];
  /** The verified platform owner, who manages the invite-only pilot. */
  isPilotOwner: boolean;
}

/** Raised when onboarding cannot complete, so the failure is visible rather than silent. */
export class OnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The verified current user, or null.
 *
 * `getUser()` rather than `getClaims()` here, and the distinction is
 * deliberate. `getClaims()` verifies a token's signature — locally against the
 * project JWKS when asymmetric keys are enabled — which means a user who was
 * revoked, banned or deleted still presents a cryptographically valid token
 * until it expires, up to an hour later. `getUser()` asks the Auth server,
 * so revocation takes effect immediately.
 *
 * For a product whose entire thesis is that authority is revocable, an hour of
 * stale access on the protected path is the wrong trade. The cheap
 * `getClaims()` check stays in middleware, where it gates and refreshes on
 * every request; this is the authoritative read that precedes loading any
 * tenant data. `getSession()` is never used on the server.
 */
export async function getVerifiedUser(supabase: SupabaseServerClient) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

async function loadMemberships(
  supabase: SupabaseServerClient,
  userId: string,
  options: { fresh?: boolean } = {},
): Promise<TenantMembership[]> {
  // The user filter is load-bearing, not redundant with RLS.
  //
  // The memberships SELECT policy grants access to every row of any tenant the
  // caller belongs to — deliberately, since member administration needs to see
  // co-members. So RLS alone returns one row per *member*, not per workspace.
  // Without `.eq("user_id", …)` a four-person tenant appears as four
  // workspaces, and the role rendered in the sidebar can be another member's.
  let query = supabase
    .from("tenant_memberships")
    .select("tenant_id, role, tenants!inner(id, name, slug, environment, created_at)")
    .eq("user_id", userId)
    // Stable ordering makes element zero a deterministic default. tenant_id
    // breaks ties so two workspaces created in the same instant cannot swap
    // order between requests.
    .order("created_at", { referencedTable: "tenants", ascending: true })
    .order("tenant_id", { ascending: true });
  if (options.fresh) query = query.abortSignal(new AbortController().signal);
  const { data, error } = await query;

  if (error) {
    throw new OnboardingError(`Could not load workspace memberships (${error.code ?? "unknown"}).`);
  }

  return (data ?? []).map((row) => ({
    tenantId: row.tenants.id,
    name: row.tenants.name,
    slug: row.tenants.slug,
    environment: row.tenants.environment,
    role: row.role,
  }));
}

/**
 * Ensures the caller is onboarded, then returns their memberships.
 *
 * Onboarding is attempted only when the caller has no membership at all, so
 * the common path costs one query rather than an RPC round trip.
 */
async function ensureOnboardedMemberships(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<TenantMembership[]> {
  const existing = await loadMemberships(supabase, userId);
  if (existing.length > 0) return existing;

  const { error } = await supabase.rpc("ensure_onboarded");

  if (error) {
    // Surfaced rather than swallowed: a user with no workspace cannot use the
    // product, and a silent empty state would hide the cause.
    throw new OnboardingError(
      `Could not finish setting up your workspace (${error.code ?? "unknown"}). Reload to retry.`,
    );
  }

  // Must not be served from Next's per-render fetch memoization: this is the
  // byte-identical GET issued above, before the workspace existed, and a
  // memoized replay of that empty answer made every brand-new user's first
  // page load fail. An AbortSignal is Next's documented opt-out.
  const created = await loadMemberships(supabase, userId, { fresh: true });

  if (created.length === 0) {
    throw new OnboardingError("Workspace setup completed without creating a workspace.");
  }

  return created;
}

/**
 * Loads the identity for the current request, or null when unauthenticated.
 *
 * Wrapped in React's `cache`, which deduplicates per request rather than
 * across requests. The protected layout and the pages beneath it both need the
 * identity; without this they would each re-verify the user and re-query
 * memberships on every render.
 */
export const loadIdentity = cache(async (): Promise<AuthorityIdentity | null> => {
  const supabase = await createClient();
  const user = await getVerifiedUser(supabase);

  if (!user) return null;

  // The invite-only pilot gate, before any workspace is created or read.
  // Decided in the database from the verified account; a session alone
  // (including one for an account created by calling Supabase directly)
  // is not enough. ensure_onboarded() enforces the same rule itself.
  const pilot = await loadPilotViewer(supabase);
  if (pilot.access !== "eligible") redirect(INVITE_ONLY_PATH);

  const memberships = await ensureOnboardedMemberships(supabase, user.id);

  const cookieStore = await cookies();
  const requested = cookieStore.get(TENANT_COOKIE_NAME)?.value ?? null;

  const resolution = resolveCurrentTenant(memberships, requested);

  if (!resolution) {
    throw new OnboardingError("No workspace is available for this account.");
  }

  // The cookie is not rewritten here: Server Components cannot set cookies.
  // Persisting a corrected value is the workspace-switch action's job. Until
  // then resolution recomputes the same deterministic default on every
  // request, which is correct without being persisted.

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? "",
    // Falls back through profile, then signup metadata, then the email local
    // part, so the sidebar always renders something real.
    displayName:
      profile?.display_name?.trim() ||
      (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "") ||
      user.email?.split("@")[0] ||
      "Account",
    avatarUrl: profile?.avatar_url ?? null,
    tenant: resolution.current,
    role: resolution.current.role,
    memberships,
    isPilotOwner: pilot.isOwner,
  };
});

/**
 * Loads the identity for a protected page, redirecting to `/login` when there
 * is no verified session.
 *
 * `returnPath` is the path the user was trying to reach, preserved through the
 * login round trip. `loginUrlFor` validates it, so a hostile value cannot
 * become an open redirect.
 */
export async function requireIdentity(returnPath: string): Promise<AuthorityIdentity> {
  const identity = await loadIdentity();

  if (!identity) {
    redirect(loginUrlFor(returnPath));
  }

  return identity;
}

export { initialsFor };
