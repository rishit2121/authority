import type { AgentRepository } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { assertTenantMatch } from "../context";
import { throwDatabaseError } from "../errors";
import { agentRowToDomain } from "../mappers/agent";

export function createSupabaseAgentRepository(context: RepositoryContext): AgentRepository {
  return {
    async findById(id) {
      const { data, error } = await context.supabase.from("agents").select("*").eq("id", id).maybeSingle();

      if (error) throwDatabaseError("find agent", error);
      return data ? agentRowToDomain(data) : null;
    },

    async listByTenant(tenantId) {
      assertTenantMatch(context, tenantId);

      const { data, error } = await context.supabase
        .from("agents")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (error) throwDatabaseError("list agents", error);
      return (data ?? []).map(agentRowToDomain);
    },
  };
}
