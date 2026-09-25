import type { PrincipalRepository, TenantRepository } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { assertTenantMatch } from "../context";
import { throwDatabaseError } from "../errors";
import { principalRowToDomain } from "../mappers/principal";
import { tenantRowToDomain } from "../mappers/tenant";

/**
 * Tenant + Principal — the foundational identities every other product
 * record ultimately traces back to.
 */
export function createSupabaseTenantRepository(context: RepositoryContext): TenantRepository {
  return {
    async findById(id) {
      const { data, error } = await context.supabase.from("tenants").select("*").eq("id", id).maybeSingle();

      if (error) throwDatabaseError("find tenant", error);
      return data ? tenantRowToDomain(data) : null;
    },

    async list() {
      // RLS already scopes this to tenants the caller belongs to; a real
      // multi-tenant user would see more than one row here. Ordered by name
      // for a stable, predictable listing.
      const { data, error } = await context.supabase.from("tenants").select("*").order("name");

      if (error) throwDatabaseError("list tenants", error);
      return (data ?? []).map(tenantRowToDomain);
    },
  };
}

export function createSupabasePrincipalRepository(context: RepositoryContext): PrincipalRepository {
  return {
    async findById(id) {
      const { data, error } = await context.supabase
        .from("principals")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throwDatabaseError("find principal", error);
      return data ? principalRowToDomain(data) : null;
    },

    async listByTenant(tenantId) {
      assertTenantMatch(context, tenantId);

      const { data, error } = await context.supabase
        .from("principals")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true });

      if (error) throwDatabaseError("list principals", error);
      return (data ?? []).map(principalRowToDomain);
    },
  };
}
