import type { SupabaseClient } from "@supabase/supabase-js";

import { RepositoryError } from "./errors";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The verified tenant context every Supabase-backed repository is
 * constructed with.
 *
 * `tenantId` must come from a server-verified membership — the resolved
 * tenant from `requireIdentity()`/`loadIdentity()` in `lib/auth/identity.ts`,
 * never a raw value copied out of a form, query string or cookie. Binding it
 * at construction, rather than accepting it per call, makes "which tenant is
 * this repository allowed to touch" a single fact checked once instead of a
 * parameter every method has to remember to re-verify.
 *
 * This is also why every method on the existing repository interfaces that
 * *does* take a `tenantId` argument (`listByTenant(tenantId)`, etc.) still
 * gets that argument checked against the bound context before running any
 * query — see `assertTenantMatch` below. RLS is the real backstop regardless,
 * but a mismatch here is a programming error worth surfacing immediately
 * rather than one RLS would otherwise mask as "zero rows".
 */
export interface RepositoryContext {
  supabase: SupabaseClient<Database>;
  tenantId: string;
}

/**
 * Throws unless `requested` is exactly the tenant this context is bound to.
 *
 * Never accept a tenant id from a caller and trust it directly — this is the
 * one place that trust boundary is enforced at the repository layer, before
 * a query is even built.
 */
export function assertTenantMatch(context: RepositoryContext, requested: string): void {
  if (requested !== context.tenantId) {
    throw new RepositoryError(
      "tenant_mismatch",
      "Requested tenant does not match the verified repository context.",
    );
  }
}
