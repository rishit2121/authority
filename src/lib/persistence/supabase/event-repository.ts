import type { ExecutionEventRepository } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { throwDatabaseError } from "../errors";
import { executionEventRowToDomain } from "../mappers/execution-event";
import { cursorFilter, decodeCursor, encodeCursor, resolveLimit } from "../keyset-pagination";

export function createSupabaseEventRepository(context: RepositoryContext): ExecutionEventRepository {
  return {
    async listByTaskId(taskId) {
      const { data, error } = await context.supabase
        .from("execution_events")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });

      if (error) throwDatabaseError("list execution events", error);
      return (data ?? []).map(executionEventRowToDomain);
    },

    /**
     * The one list method most likely to run long in a real workspace — a
     * task's full audit trail only grows. Bounded and cursor-paginated
     * rather than fetched whole; the task investigation view's timeline
     * should page through this, not load every event a task has ever
     * produced.
     */
    async listByTaskIdPaged(taskId, options) {
      const limit = resolveLimit(options);
      const cursor = decodeCursor(options?.cursor);

      let query = context.supabase
        .from("execution_events")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);

      if (cursor) query = query.or(cursorFilter(cursor));

      const { data, error } = await query;
      if (error) throwDatabaseError("list execution events (paged)", error);

      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);

      return {
        items: page.map(executionEventRowToDomain),
        nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
      };
    },
  };
}
