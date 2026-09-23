import Link from "next/link";

import { DemoDataNotice } from "@/components/dashboard/DemoDataNotice";
import { EmptyWorkspace } from "@/components/dashboard/EmptyWorkspace";
import { TaskTraceTable } from "@/components/dashboard/TaskTraceTable";
import { Icon } from "@/components/ui/Icon";
import { TENANT_ROLE_LABELS } from "@/lib/auth/tenant-context";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

const PAGE_SIZE = 25;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/tasks");
  const params = await searchParams;
  const cursorParam = params.cursor;
  const cursor = typeof cursorParam === "string" ? cursorParam : undefined;

  const [agents, principals, page] = await Promise.all([
    repositories.agents.listByTenant(identity.tenant.tenantId),
    repositories.principals.listByTenant(identity.tenant.tenantId),
    repositories.tasks.listByTenantPaged(identity.tenant.tenantId, { limit: PAGE_SIZE, cursor }),
  ]);

  const taskIds = page.items.map((task) => task.id);
  const decisionCounts = await repositories.decisions.countByTaskIds(taskIds);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "unknown-agent";
  const principalName = (id: string) => principals.find((p) => p.id === id)?.displayName ?? "unknown";

  const traces = page.items.map((task) => {
    const counts = decisionCounts.get(task.id) ?? { total: 0, blocked: 0 };
    return {
      task,
      agentName: agentName(task.agentId),
      principalName: principalName(task.principalId),
      decisionCount: counts.total,
      blockedCount: counts.blocked,
    };
  });

  const hasAnyTasks = cursor !== undefined || page.items.length > 0;
  const canManageDemoData = identity.role !== "viewer" && TENANT_ROLE_LABELS[identity.role] !== undefined;

  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-center justify-between gap-space-md">
        <div>
          <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
            Tasks
          </h1>
          <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
            Every delegated task and the authority it received.
          </p>
        </div>
        <Link
          href="/app/tasks/new"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-space-lg py-2.5 font-headline-sm text-body-md font-medium text-on-primary transition-colors hover:bg-primary-fixed"
        >
          <Icon name="account_tree" size={16} />
          New task
        </Link>
      </header>

      {!hasAnyTasks ? (
        <EmptyWorkspace />
      ) : (
        <>
          <DemoDataNotice showReset={canManageDemoData} />
          <TaskTraceTable traces={traces} />

          {cursor || page.nextCursor ? (
            <nav aria-label="Task pages" className="flex items-center justify-between gap-space-md">
              {cursor ? (
                <Link
                  href="/app/tasks"
                  className="font-body-sm text-body-sm text-on-surface-variant underline decoration-outline/40 underline-offset-2 hover:text-on-surface"
                >
                  Back to first page
                </Link>
              ) : (
                <span />
              )}
              {page.nextCursor ? (
                <Link
                  href={`/app/tasks?cursor=${encodeURIComponent(page.nextCursor)}`}
                  className="inline-flex items-center gap-1 font-body-sm text-body-sm text-primary-container hover:underline"
                >
                  Next page
                  <Icon name="arrow_forward" size={13} />
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
