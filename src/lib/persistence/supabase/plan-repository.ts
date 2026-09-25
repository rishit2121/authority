import type { PlanRepository, ToolRequestRepository } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { throwDatabaseError } from "../errors";
import { decodeCursor, encodeCursor, resolveLimit } from "../keyset-pagination";
import { planRowsToDomain } from "../mappers/plan";
import { toolRequestRowToDomain } from "../mappers/tool-request";

export function createSupabasePlanRepository(context: RepositoryContext): PlanRepository {
  return {
    async findByTaskId(taskId) {
      // Highest version, same reasoning as contracts: superseding a plan
      // means a new (task_id, version) row, never an edit of this one.
      const { data: planRow, error: planError } = await context.supabase
        .from("plans")
        .select("*")
        .eq("task_id", taskId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (planError) throwDatabaseError("find plan", planError);
      if (!planRow) return null;

      const { data: nodeRows, error: nodesError } = await context.supabase
        .from("plan_nodes")
        .select("*")
        .eq("plan_id", planRow.id)
        .order("sequence_no", { ascending: true });

      if (nodesError) throwDatabaseError("list plan nodes", nodesError);

      return planRowsToDomain(planRow, nodeRows ?? []);
    },
  };
}

export function createSupabaseToolRequestRepository(context: RepositoryContext): ToolRequestRepository {
  return {
    async listByTaskId(taskId) {
      const { data, error } = await context.supabase
        .from("tool_requests")
        .select("*")
        .eq("task_id", taskId)
        .order("requested_at", { ascending: true });

      if (error) throwDatabaseError("list tool requests", error);
      return (data ?? []).map(toolRequestRowToDomain);
    },

    async listByTaskIdPaged(taskId, options) {
      const limit = resolveLimit(options);
      const cursor = decodeCursor(options?.cursor);

      let query = context.supabase
        .from("tool_requests")
        .select("*")
        .eq("task_id", taskId)
        .order("requested_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);

      // The shared cursor helper is written for `created_at`; tool_requests
      // orders by `requested_at` instead, so the filter is built directly
      // rather than reused verbatim.
      if (cursor) {
        query = query.or(
          `requested_at.lt.${cursor.createdAt},and(requested_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
        );
      }

      const { data, error } = await query;
      if (error) throwDatabaseError("list tool requests (paged)", error);

      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);

      return {
        items: page.map(toolRequestRowToDomain),
        nextCursor: hasMore && last ? encodeCursor({ createdAt: last.requested_at, id: last.id }) : null,
      };
    },
  };
}
