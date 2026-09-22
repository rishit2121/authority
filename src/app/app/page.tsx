import Link from "next/link";

import { DemoDataNotice } from "@/components/dashboard/DemoDataNotice";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { TaskTraceTable } from "@/components/dashboard/TaskTraceTable";
import { Icon } from "@/components/ui/Icon";
import { requireIdentity } from "@/lib/auth/identity";
import { TENANT_ENVIRONMENT_LABELS } from "@/lib/auth/tenant-context";
import { loadDashboardOverview } from "@/lib/data/dashboard";

export default async function OverviewPage() {
  // Real: the workspace name and environment come from the signed-in user's
  // membership. Still mocked: the metrics and traces below.
  const identity = await requireIdentity("/app");
  const { metrics, traces } = await loadDashboardOverview();

  return (
    <div className="flex flex-col gap-space-xl">
      <header>
        <div className="flex flex-wrap items-center gap-space-sm">
          <span className="font-label-caps text-label-caps uppercase tracking-widest text-primary">
            {identity.tenant.name}
          </span>
          <span className="inline-flex items-center rounded-full border border-outline-variant/30 px-2 py-0.5 font-mono-token text-[10px] uppercase tracking-wider text-outline">
            {TENANT_ENVIRONMENT_LABELS[identity.tenant.environment]}
          </span>
        </div>
        <h1 className="mt-space-xs font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Overview
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Runtime authorization activity across every registered agent.
        </p>
      </header>

      <DemoDataNotice />

      <section
        aria-label="Key metrics"
        className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-3"
      >
        {metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </section>

      <section className="rounded-xl border border-primary/30 bg-primary/5 p-space-lg">
        <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-center">
          <div>
            <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              Worked example: GitHub issue #991
            </h2>
            <p className="mt-1 max-w-xl font-body-md text-body-md text-on-surface-variant">
              A coding agent resolved an issue and opened a pull request. One request for repository secrets
              was denied. Inspect the full contract, plan and decision trace.
            </p>
          </div>
          <Link
            href="/app/tasks/demo-task"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-space-lg py-2.5 font-headline-sm text-body-md font-medium text-on-primary transition-colors hover:bg-primary-fixed"
          >
            Open task investigation
            <Icon name="arrow_forward" size={16} />
          </Link>
        </div>
      </section>

      <section aria-labelledby="recent-traces" className="flex flex-col gap-space-md">
        <h2 id="recent-traces" className="font-headline-sm text-headline-sm font-semibold text-on-surface">
          Recent task traces
        </h2>
        <TaskTraceTable traces={traces} />
      </section>
    </div>
  );
}
