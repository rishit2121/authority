import Link from "next/link";

import { TaskFilters } from "@/components/dashboard/TaskFilters";
import { TasksTable, type TaskRow } from "@/components/dashboard/TasksTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import type { TaskStatus } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

const PAGE_SIZE = 25;

function firstParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/tasks");
  const params = await searchParams;
  const cursor = firstParam(params.cursor) || undefined;
  const status = firstParam(params.status);
  const agentId = firstParam(params.agent);
  const search = firstParam(params.q);

  const [agents, page] = await Promise.all([
    repositories.agents.listByTenant(identity.tenant.tenantId),
    repositories.tasks.listByTenantPaged(
      identity.tenant.tenantId,
      { limit: PAGE_SIZE, cursor },
      {
        status: (status as TaskStatus) || undefined,
        agentId: agentId || undefined,
        search: search || undefined,
      },
    ),
  ]);

  const contracts = await repositories.contracts.listLatestByTaskIds(page.items.map((task) => task.id));
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "Unknown agent";

  const rows: TaskRow[] = page.items.map((task) => ({
    task,
    agentName: agentName(task.agentId),
    contract: contracts.get(task.id) ?? null,
  }));

  const hasFilters = Boolean(status || agentId || search);
  const hasAnyTasks = cursor !== undefined || hasFilters || rows.length > 0;

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Tasks"
        description="Every delegated task and the authority it received."
        primaryAction={{ label: "New task", href: "/app/tasks/new" }}
      />

      {!hasAnyTasks ? (
        <EmptyState
          icon="account_tree"
          heading="No tasks yet"
          description="Create a task to see the authority an agent needs before it acts."
          action={{ label: "Create task", href: "/app/tasks/new" }}
        />
      ) : (
        <>
          <TaskFilters agents={agents} status={status} agentId={agentId} search={search} />

          {rows.length === 0 ? (
            <EmptyState
              icon="data_object"
              heading="No tasks match these filters"
              description="Try a different status, agent, or search term."
            />
          ) : (
            <TasksTable rows={rows} />
          )}

          {cursor || page.nextCursor ? (
            <nav aria-label="Task pages" className="flex items-center justify-between gap-space-md">
              {cursor ? (
                <Link
                  href="/app/tasks"
                  className="text-[13px] text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink"
                >
                  Back to first page
                </Link>
              ) : (
                <span />
              )}
              {page.nextCursor ? (
                <Link
                  href={`/app/tasks?cursor=${encodeURIComponent(page.nextCursor)}`}
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-ink hover:underline"
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
