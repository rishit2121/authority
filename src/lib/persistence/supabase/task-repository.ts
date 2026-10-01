import type { ContractRepository, TaskAuthorityContract, TaskRepository } from "@/lib/domain";

import type { RepositoryContext } from "../context";
import { assertTenantMatch } from "../context";
import { throwDatabaseError } from "../errors";
import { contractRowToDomain } from "../mappers/contract";
import { taskRowToDomain } from "../mappers/task";
import { cursorFilter, decodeCursor, encodeCursor, resolveLimit } from "../keyset-pagination";

export function createSupabaseTaskRepository(context: RepositoryContext): TaskRepository {
  return {
    async findById(id) {
      const { data, error } = await context.supabase.from("tasks").select("*").eq("id", id).maybeSingle();

      if (error) throwDatabaseError("find task", error);
      return data ? taskRowToDomain(data) : null;
    },

    async listByTenant(tenantId) {
      assertTenantMatch(context, tenantId);

      const { data, error } = await context.supabase
        .from("tasks")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (error) throwDatabaseError("list tasks", error);
      return (data ?? []).map(taskRowToDomain);
    },

    async listByTenantPaged(tenantId, options, filters) {
      assertTenantMatch(context, tenantId);

      const limit = resolveLimit(options);
      const cursor = decodeCursor(options?.cursor);

      let query = context.supabase
        .from("tasks")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        // One extra row, never returned, just to know whether a next page exists.
        .limit(limit + 1);

      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.agentId) query = query.eq("agent_id", filters.agentId);
      if (filters?.search) query = query.ilike("intent", `%${filters.search}%`);
      if (cursor) query = query.or(cursorFilter(cursor));

      const { data, error } = await query;
      if (error) throwDatabaseError("list tasks (paged)", error);

      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);

      return {
        items: page.map(taskRowToDomain),
        nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
      };
    },
  };
}

export function createSupabaseContractRepository(context: RepositoryContext): ContractRepository {
  return {
    async findByTaskId(taskId) {
      // Contracts are append-only-by-version (see contracts_immutable_once_active
      // in 20260923000009_lifecycle_triggers.sql), so "the" contract for a task
      // is its highest version — never ambiguous even once a second version
      // exists.
      const { data, error } = await context.supabase
        .from("task_authority_contracts")
        .select("*")
        .eq("task_id", taskId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throwDatabaseError("find contract", error);
      return data ? contractRowToDomain(data) : null;
    },

    async findActiveByTaskId(taskId) {
      const { data, error } = await context.supabase
        .from("task_authority_contracts")
        .select("*")
        .eq("task_id", taskId)
        .eq("contract_status", "active")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throwDatabaseError("find active contract", error);
      return data ? contractRowToDomain(data) : null;
    },

    async findById(contractId) {
      const { data, error } = await context.supabase
        .from("task_authority_contracts")
        .select("*")
        .eq("id", contractId)
        .maybeSingle();

      if (error) throwDatabaseError("find contract by id", error);
      return data ? contractRowToDomain(data) : null;
    },

    async listByTaskId(taskId) {
      const { data, error } = await context.supabase
        .from("task_authority_contracts")
        .select("*")
        .eq("task_id", taskId)
        .order("version", { ascending: false });

      if (error) throwDatabaseError("list contracts", error);
      return (data ?? []).map(contractRowToDomain);
    },

    async listLatestByTaskIds(taskIds) {
      if (taskIds.length === 0) return new Map();

      const { data, error } = await context.supabase
        .from("task_authority_contracts")
        .select("*")
        .in("task_id", taskIds)
        .order("version", { ascending: false });

      if (error) throwDatabaseError("list latest contracts", error);

      const latestByTask = new Map<string, TaskAuthorityContract>();
      for (const row of data ?? []) {
        if (!latestByTask.has(row.task_id)) latestByTask.set(row.task_id, contractRowToDomain(row));
      }
      return latestByTask;
    },
  };
}
