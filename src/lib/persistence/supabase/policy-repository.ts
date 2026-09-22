import type { PolicyRepository } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { assertTenantMatch } from "../context";
import { throwDatabaseError } from "../errors";
import { policyRowToDomain } from "../mappers/policy";

export function createSupabasePolicyRepository(context: RepositoryContext): PolicyRepository {
  return {
    async findById(id) {
      const { data, error } = await context.supabase.from("policies").select("*").eq("id", id).maybeSingle();

      if (error) throwDatabaseError("find policy", error);
      return data ? policyRowToDomain(data) : null;
    },

    async listByTenant(tenantId) {
      assertTenantMatch(context, tenantId);

      // Small table by design — see repositories.ts's note on which lists
      // get a paginated sibling and which don't.
      const { data, error } = await context.supabase
        .from("policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true })
        .order("version", { ascending: false });

      if (error) throwDatabaseError("list policies", error);
      return (data ?? []).map(policyRowToDomain);
    },
  };
}
