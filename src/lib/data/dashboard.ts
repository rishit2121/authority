import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthorityRepositories, Task } from "@/lib/domain";
import { mockRepositories } from "@/lib/mock";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/**
 * Loaders sit between pages and the repository seam.
 *
 * Pages call these; components receive plain props. Nothing in
 * `components/` imports fixtures directly, so swapping the repository
 * implementation later needs no component changes.
 */

export interface OverviewMetric {
  id: string;
  label: string;
  value: number;
  /** Short qualifier shown under the value. */
  caption: string;
  tone: "cyan" | "violet" | "green" | "amber" | "rose" | "neutral";
}

export interface TaskTrace {
  task: Task;
  agentName: string;
  principalName: string;
  decisionCount: number;
  blockedCount: number;
}

export interface DashboardOverview {
  metrics: OverviewMetric[];
  traces: TaskTrace[];
  /** True once agents or tasks exist; drives the empty-workspace state. */
  hasAnyProductData: boolean;
}

/** Recent task traces shown on the dashboard — bounded, not "every task ever". */
const RECENT_TASKS_LIMIT = 20;

/**
 * Six repository calls, fixed, regardless of how many tasks or decisions the
 * tenant has:
 *
 *   1. agents.listByTenant        4. principals.listByTenant
 *   2. tasks.listByTenantPaged    5. capabilities.listActiveByTenant
 *   3. approvals.listPendingByTenant
 *   6. decisions.countByTaskIds (one batched call covering every task in the
 *      page above, not one call per task)
 *
 * The last point is the one that matters: an earlier version of this loader
 * called `decisions.listByTaskId` once per task, which is exactly the N+1
 * pattern a real (non-mock) backend would make expensive as task counts
 * grow. `countByTaskIds` exists specifically to keep this loader at a fixed
 * query count.
 */
export async function loadDashboardOverview(
  repositories: AuthorityRepositories = mockRepositories,
  tenantId = "ten_northwind",
): Promise<DashboardOverview> {
  const [agents, tasksPage, approvals, principals, activeCapabilities] = await Promise.all([
    repositories.agents.listByTenant(tenantId),
    repositories.tasks.listByTenantPaged(tenantId, { limit: RECENT_TASKS_LIMIT }),
    repositories.approvals.listPendingByTenant(tenantId),
    repositories.principals.listByTenant(tenantId),
    repositories.capabilities.listActiveByTenant(tenantId),
  ]);

  const tasks = tasksPage.items;
  const decisionCounts = await repositories.decisions.countByTaskIds(tasks.map((task) => task.id));

  let totalDecisions = 0;
  let totalBlocked = 0;
  for (const counts of decisionCounts.values()) {
    totalDecisions += counts.total;
    totalBlocked += counts.blocked;
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "unknown-agent";
  const principalName = (id: string) => principals.find((p) => p.id === id)?.displayName ?? "unknown";

  const metrics: OverviewMetric[] = [
    {
      id: "active-agents",
      label: "Active agents",
      value: agents.filter((a) => a.status === "active").length,
      caption: `${agents.length} registered`,
      tone: "cyan",
    },
    {
      id: "protected-calls",
      label: "Protected tool calls",
      value: totalDecisions,
      caption: "evaluated this window",
      tone: "violet",
    },
    {
      id: "blocked-requests",
      label: "Blocked requests",
      value: totalBlocked,
      caption: "denied or sent back to replan",
      tone: "rose",
    },
    {
      id: "pending-approvals",
      label: "Pending approvals",
      value: approvals.length,
      caption: "awaiting a human principal",
      tone: "amber",
    },
    {
      id: "active-capabilities",
      label: "Active capabilities",
      value: activeCapabilities.length,
      caption: "0 standing permissions",
      tone: "green",
    },
    {
      id: "tasks",
      label: "Tasks",
      value: tasks.length,
      caption: `${tasks.filter((t) => t.status === "executing").length} executing now`,
      tone: "neutral",
    },
  ];

  // Already ordered newest-first by listByTenantPaged; re-sorting here would
  // just repeat that guarantee, so the loader trusts the repository's own
  // documented ordering instead.
  const traces: TaskTrace[] = tasks.map((task) => {
    const counts = decisionCounts.get(task.id) ?? { total: 0, blocked: 0 };
    return {
      task,
      agentName: agentName(task.agentId),
      principalName: principalName(task.principalId),
      decisionCount: counts.total,
      blockedCount: counts.blocked,
    };
  });

  return { metrics, traces, hasAnyProductData: agents.length > 0 || tasks.length > 0 };
}

export interface TaskNeedingAttention {
  task: Task;
  agentName: string;
  reason: "failed" | "awaiting_approval" | "contract_expired";
}

const ATTENTION_LIMIT = 5;

/**
 * Tasks a person should look at, drawn from the traces the dashboard already
 * loaded above rather than a new tenant-wide query: "failed" and
 * "awaiting_approval" come straight off each trace's own task status; the
 * contract check below is the only extra query, and it is one batched
 * `IN (...)` call — the same batching discipline `countByTaskIds` already
 * established — never one call per task.
 */
export async function loadTasksNeedingAttention(
  repositories: AuthorityRepositories,
  traces: TaskTrace[],
): Promise<TaskNeedingAttention[]> {
  const attention: TaskNeedingAttention[] = [];
  for (const trace of traces) {
    if (trace.task.status === "failed") {
      attention.push({ task: trace.task, agentName: trace.agentName, reason: "failed" });
    } else if (trace.task.status === "awaiting_approval") {
      attention.push({ task: trace.task, agentName: trace.agentName, reason: "awaiting_approval" });
    }
  }

  const stillOpen = traces.filter((t) => t.task.status !== "failed" && t.task.status !== "awaiting_approval");
  if (stillOpen.length > 0) {
    const latestContracts = await repositories.contracts.listLatestByTaskIds(stillOpen.map((t) => t.task.id));
    for (const trace of stillOpen) {
      if (latestContracts.get(trace.task.id)?.status === "expired") {
        attention.push({ task: trace.task, agentName: trace.agentName, reason: "contract_expired" });
      }
    }
  }

  return attention.slice(0, ATTENTION_LIMIT);
}

export interface RecentToolCall {
  id: string;
  agentName: string;
  humanAction: string;
  toolOperation: string;
  resource: string | null;
  outcome: string;
  createdAt: string;
}

const RECENT_CALLS_LIMIT = 5;

/**
 * The last few authorization decisions for the "Recent tool calls" overview
 * widget — distinct from `traces` above, which aggregates per task rather
 * than listing individual calls. Reads the same tables the Tool calls page
 * (`/app/runtime`) reads, just three narrow, tenant-scoped, limited queries
 * instead of that page's full evidence join.
 */
export async function loadRecentToolCalls(db: Db, tenantId: string): Promise<RecentToolCall[]> {
  const { data: decisions } = await db
    .from("authorization_decisions")
    .select("id, outcome, tool_request_id, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(RECENT_CALLS_LIMIT);

  if (!decisions || decisions.length === 0) return [];

  const { data: requests } = await db
    .from("tool_requests")
    .select("id, tool, operation, resource, agent_id")
    .in(
      "id",
      decisions.map((d) => d.tool_request_id),
    );
  const requestById = new Map((requests ?? []).map((r) => [r.id, r]));

  const agentIds = Array.from(new Set((requests ?? []).map((r) => r.agent_id)));
  const { data: agents } = agentIds.length
    ? await db.from("agents").select("id, name").in("id", agentIds)
    : { data: [] as { id: string; name: string }[] };
  const agentNameById = new Map((agents ?? []).map((a) => [a.id, a.name]));

  return decisions.map((decision) => {
    const request = requestById.get(decision.tool_request_id);
    return {
      id: decision.id,
      agentName: request ? (agentNameById.get(request.agent_id) ?? "Unknown agent") : "Unknown agent",
      humanAction: request ? `${request.tool} · ${request.operation}` : "Unknown action",
      toolOperation: request ? `${request.tool}.${request.operation}` : "unknown",
      resource: request?.resource ?? null,
      outcome: decision.outcome,
      createdAt: decision.created_at,
    };
  });
}
