import type { AuthorityRepositories } from "@/lib/domain";
import { mockRepositories } from "@/lib/mock";
import type { NavBadgeCounts } from "@/lib/dashboard-nav";

/** Sidebar badge counts, read through the repository seam. */
export async function loadNavBadges(
  repositories: AuthorityRepositories = mockRepositories,
  tenantId = "ten_northwind",
): Promise<NavBadgeCounts> {
  const [tasks, approvals, integrations] = await Promise.all([
    repositories.tasks.listByTenant(tenantId),
    repositories.approvals.listPendingByTenant(tenantId),
    repositories.integrations.listByTenant(tenantId),
  ]);

  return {
    tasksActive: tasks.filter((task) => task.status === "executing").length,
    approvalsPending: approvals.length,
    integrationWarnings: integrations.filter((integration) => integration.status === "warning").length,
  };
}
