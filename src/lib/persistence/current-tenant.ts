import { requireIdentity, type AuthorityIdentity } from "@/lib/auth/identity";
import { createClient } from "@/lib/supabase/server";

import { createSupabaseRepositories } from "./supabase";

/**
 * The server-only composition point every `/app/*` product page uses.
 *
 * This is the only place a Supabase-backed `AuthorityRepositories` is
 * constructed for the application (as opposed to a test). It does four
 * things, in order, and none of them can be skipped by a caller:
 *
 *  1. Verifies the authenticated user — `requireIdentity()` calls
 *     `supabase.auth.getUser()`, which asks the Auth server rather than
 *     trusting a decoded session cookie, and redirects to `/login` if there
 *     is none.
 *  2. Resolves the selected tenant — from the `authority_tenant` cookie,
 *     but only ever as a *hint*: `resolveCurrentTenant()` re-derives the
 *     caller's real memberships from the database first and ignores the
 *     cookie's value if it doesn't name one of them.
 *  3. Revalidates membership — the membership list above is read fresh on
 *     every call (via React's `cache()` inside `loadIdentity()`, so this
 *     costs one query per request, not one per call site).
 *  4. Constructs Supabase repositories bound to exactly that verified
 *     tenant id.
 *
 * There is no parameter here that accepts a tenant id from a caller. The
 * only tenant this can ever return repositories for is the one
 * `requireIdentity()` independently resolved for the current request — a
 * page cannot pass a tenant id from a query string, form or cookie and have
 * it trusted.
 */
export interface CurrentTenantContext {
  identity: AuthorityIdentity;
  repositories: ReturnType<typeof createSupabaseRepositories>;
}

export async function createRepositoriesForCurrentTenant(
  returnPath: string,
): Promise<CurrentTenantContext> {
  const identity = await requireIdentity(returnPath);
  const supabase = await createClient();

  const repositories = createSupabaseRepositories({
    supabase,
    tenantId: identity.tenant.tenantId,
  });

  return { identity, repositories };
}
