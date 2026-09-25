import type { IntegrationRepository } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { assertTenantMatch } from "../context";
import { throwDatabaseError } from "../errors";
import { integrationRowToDomain } from "../mappers/integration";

export function createSupabaseIntegrationRepository(context: RepositoryContext): IntegrationRepository {
  return {
    async findById(id) {
      const { data, error } = await context.supabase
        .from("integrations")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throwDatabaseError("find integration", error);
      return data ? integrationRowToDomain(data) : null;
    },

    async listByTenant(tenantId) {
      assertTenantMatch(context, tenantId);

      const { data, error } = await context.supabase
        .from("integrations")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("provider", { ascending: true });

      if (error) throwDatabaseError("list integrations", error);
      return (data ?? []).map(integrationRowToDomain);
    },
  };
}
