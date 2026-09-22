import { isPermitted, type AuthorityRepositories, type Task } from "@/lib/domain";
import { mockRepositories } from "@/lib/mock";

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
}

export async function loadDashboardOverview(
  repositories: AuthorityRepositories = mockRepositories,
  tenantId = "ten_northwind",
): Promise<DashboardOverview> {
  const [agents, tasks, approvals, principals] = await Promise.all([
    repositories.agents.listByTenant(tenantId),
    repositories.tasks.listByTenant(tenantId),
    repositories.approvals.listPendingByTenant(tenantId),
    repositories.principals.listByTenant(tenantId),
  ]);

  const activeCapabilities = await repositories.capabilities.listActiveByTenant(tenantId);

  const perTask = await Promise.all(
    tasks.map(async (task) => ({
      task,
      decisions: await repositories.decisions.listByTaskId(task.id),
    })),
  );

  const allDecisions = perTask.flatMap((entry) => entry.decisions);
  const blocked = allDecisions.filter((decision) => !isPermitted(decision.status));

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
      value: allDecisions.length,
      caption: "evaluated this window",
      tone: "violet",
    },
    {
      id: "blocked-requests",
      label: "Blocked requests",
      value: blocked.length,
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

  const traces: TaskTrace[] = perTask
    .map(({ task, decisions }) => ({
      task,
      agentName: agentName(task.agentId),
      principalName: principalName(task.principalId),
      decisionCount: decisions.length,
      blockedCount: decisions.filter((d) => !isPermitted(d.status)).length,
    }))
    .sort((a, b) => Date.parse(b.task.createdAt) - Date.parse(a.task.createdAt));

  return { metrics, traces };
}
