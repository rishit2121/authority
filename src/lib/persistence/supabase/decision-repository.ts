import type { CapabilityRepository, DecisionRepository } from "@/lib/domain";
import type { Database } from "@/lib/supabase/database.types";

import type { RepositoryContext } from "../context";
import { assertTenantMatch } from "../context";
import { throwDatabaseError } from "../errors";
import { decisionRowToDomain } from "../mappers/decision";
import { capabilityRowToDomain } from "../mappers/capability";
import { cursorFilter, decodeCursor, encodeCursor, resolveLimit } from "../keyset-pagination";

type SemanticRow = Database["public"]["Tables"]["semantic_decisions"]["Row"];

/**
 * Batch-fetches the semantic_decisions rows a set of authorization_decisions
 * rows reference, keyed by id.
 *
 * Every decision-listing method below fetches its decisions with one query
 * and their semantic evidence with exactly one more, regardless of how many
 * decisions came back — never one semantic lookup per decision. This is the
 * N+1 pattern the task investigation view would otherwise fall into: a task
 * with a dozen decisions must not cost a dozen extra round trips just to
 * attach their evidence.
 */
async function fetchSemanticRowsByIds(
  context: RepositoryContext,
  ids: readonly string[],
): Promise<Map<string, SemanticRow>> {
  if (ids.length === 0) return new Map();

  const { data, error } = await context.supabase.from("semantic_decisions").select("*").in("id", ids);

  if (error) throwDatabaseError("batch-fetch semantic decisions", error);

  return new Map((data ?? []).map((row) => [row.id, row]));
}

export function createSupabaseDecisionRepository(context: RepositoryContext): DecisionRepository {
  return {
    async findById(id) {
      const { data, error } = await context.supabase
        .from("authorization_decisions")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throwDatabaseError("find decision", error);
      if (!data) return null;

      const semanticRows = data.semantic_decision_id
        ? await fetchSemanticRowsByIds(context, [data.semantic_decision_id])
        : new Map<string, SemanticRow>();

      return decisionRowToDomain(
        data,
        data.semantic_decision_id ? semanticRows.get(data.semantic_decision_id) : null,
      );
    },

    async listByTaskId(taskId) {
      const { data, error } = await context.supabase
        .from("authorization_decisions")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });

      if (error) throwDatabaseError("list decisions", error);
      const rows = data ?? [];

      const semanticIds = rows
        .map((row) => row.semantic_decision_id)
        .filter((id): id is string => id !== null);
      const semanticRows = await fetchSemanticRowsByIds(context, semanticIds);

      return rows.map((row) =>
        decisionRowToDomain(
          row,
          row.semantic_decision_id ? semanticRows.get(row.semantic_decision_id) : null,
        ),
      );
    },

    async listByTaskIdPaged(taskId, options) {
      const limit = resolveLimit(options);
      const cursor = decodeCursor(options?.cursor);

      let query = context.supabase
        .from("authorization_decisions")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1);

      if (cursor) query = query.or(cursorFilter(cursor));

      const { data, error } = await query;
      if (error) throwDatabaseError("list decisions (paged)", error);

      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);

      const semanticIds = page
        .map((row) => row.semantic_decision_id)
        .filter((id): id is string => id !== null);
      const semanticRows = await fetchSemanticRowsByIds(context, semanticIds);

      return {
        items: page.map((row) =>
          decisionRowToDomain(
            row,
            row.semantic_decision_id ? semanticRows.get(row.semantic_decision_id) : null,
          ),
        ),
        nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
      };
    },
  };
}

export function createSupabaseCapabilityRepository(context: RepositoryContext): CapabilityRepository {
  return {
    async listByTaskId(taskId) {
      const { data, error } = await context.supabase
        .from("capabilities")
        .select("*")
        .eq("task_id", taskId)
        .order("issued_at", { ascending: true });

      if (error) throwDatabaseError("list capabilities", error);
      return (data ?? []).map(capabilityRowToDomain);
    },

    async listActiveByTenant(tenantId) {
      assertTenantMatch(context, tenantId);

      const { data, error } = await context.supabase
        .from("capabilities")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("expires_at", { ascending: true });

      if (error) throwDatabaseError("list active capabilities", error);
      return (data ?? []).map(capabilityRowToDomain);
    },

    async listActiveByTenantPaged(tenantId, options) {
      assertTenantMatch(context, tenantId);

      const limit = resolveLimit(options);
      const cursor = decodeCursor(options?.cursor);

      // Ordered by expires_at, not created_at: the operationally relevant
      // question for "active capabilities" is which expire soonest, not
      // which were issued most recently.
      let query = context.supabase
        .from("capabilities")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .order("expires_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit + 1);

      if (cursor) {
        query = query.or(
          `expires_at.gt.${cursor.createdAt},and(expires_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
        );
      }

      const { data, error } = await query;
      if (error) throwDatabaseError("list active capabilities (paged)", error);

      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);

      return {
        items: page.map(capabilityRowToDomain),
        nextCursor: hasMore && last ? encodeCursor({ createdAt: last.expires_at, id: last.id }) : null,
      };
    },
  };
}
