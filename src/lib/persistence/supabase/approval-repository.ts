import type { ApprovalRepository } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { assertTenantMatch } from "../context";
import { throwDatabaseError } from "../errors";
import { approvalRowToDomain } from "../mappers/approval";
import { cursorFilter, decodeCursor, encodeCursor, resolveLimit } from "../keyset-pagination";

export function createSupabaseApprovalRepository(context: RepositoryContext): ApprovalRepository {
  return {
    async listByTenant(tenantId) {
      assertTenantMatch(context, tenantId);

      const { data, error } = await context.supabase
        .from("approvals")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("requested_at", { ascending: false });

      if (error) throwDatabaseError("list approvals", error);
      return (data ?? []).map(approvalRowToDomain);
    },

    async listPendingByTenant(tenantId) {
      assertTenantMatch(context, tenantId);

      const { data, error } = await context.supabase
        .from("approvals")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "pending")
        .order("requested_at", { ascending: true });

      if (error) throwDatabaseError("list pending approvals", error);
      return (data ?? []).map(approvalRowToDomain);
    },

    async listByTenantPaged(tenantId, options) {
      assertTenantMatch(context, tenantId);

      const limit = resolveLimit(options);
      const cursor = decodeCursor(options?.cursor);

      let query = context.supabase
        .from("approvals")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);

      if (cursor) query = query.or(cursorFilter(cursor));

      const { data, error } = await query;
      if (error) throwDatabaseError("list approvals (paged)", error);

      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);

      return {
        items: page.map(approvalRowToDomain),
        nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
      };
    },
  };
}
