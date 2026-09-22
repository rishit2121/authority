import type { AuthorityRepositories } from "@/lib/domain";
import { countIntegrationWarnings, mockRepositories } from "@/lib/mock";
import type { NavBadgeCounts } from "@/lib/dashboard-nav";

/** Sidebar badge counts, read through the repository seam. */
export async function loadNavBadges(
  repositories: AuthorityRepositories = mockRepositories,
  tenantId = "ten_northwind",
): Promise<NavBadgeCounts> {
  const [tasks, approvals] = await Promise.all([
    repositories.tasks.listByTenant(tenantId),
    repositories.approvals.listPendingByTenant(tenantId),
  ]);

  return {
    tasksActive: tasks.filter((task) => task.status === "executing").length,
    approvalsPending: approvals.length,
    integrationWarnings: countIntegrationWarnings(),
  };
}
