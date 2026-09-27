import Link from "next/link";

import { DemoDataNotice } from "@/components/dashboard/DemoDataNotice";
import { EmptyWorkspace } from "@/components/dashboard/EmptyWorkspace";
import type { SupabaseClient } from "@supabase/supabase-js";

import { OnboardingChecklist, type OnboardingProgress } from "@/components/dashboard/OnboardingChecklist";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { TaskTraceTable } from "@/components/dashboard/TaskTraceTable";
import { Icon } from "@/components/ui/Icon";
import { TENANT_ENVIRONMENT_LABELS, TENANT_ROLE_LABELS } from "@/lib/auth/tenant-context";
import { loadDashboardOverview } from "@/lib/data/dashboard";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

async function loadOnboardingProgress(db: Db): Promise<OnboardingProgress> {
  const head = { count: "exact", head: true } as const;
  const [agents, tasks, decisions, github, validation, contracts] = await Promise.all([
    db.from("agents").select("id", head),
    db.from("tasks").select("id", head),
    db.from("authorization_decisions").select("id", head),
    db.from("github_installations").select("id", head).neq("status", "disconnected"),
    db.from("validation_campaigns").select("id", head),
    db.from("task_authority_contracts").select("id", head).eq("contract_status", "active"),
  ]);
  return {
    agent: (agents.count ?? 0) > 0,
    task: (tasks.count ?? 0) > 0,
    activeContract: (contracts.count ?? 0) > 0,
    runtimeCall: (decisions.count ?? 0) > 0,
    githubConnected: (github.count ?? 0) > 0,
    validationRun: (validation.count ?? 0) > 0,
  };
}

export default async function OverviewPage() {
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant("/app");
  const onboarding = await loadOnboardingProgress(context.supabase);
  const { metrics, traces, hasAnyProductData } = await loadDashboardOverview(
    repositories,
    identity.tenant.tenantId,
  );

  const canManageDemoData = TENANT_ROLE_LABELS[identity.role] !== undefined && identity.role !== "viewer";

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

      <OnboardingChecklist progress={onboarding} />

      {!hasAnyProductData ? (
        <EmptyWorkspace />
      ) : (
        <>
          <DemoDataNotice showReset={canManageDemoData} />

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
                  A coding agent resolved an issue and opened a pull request. One request for repository
                  secrets was denied. Inspect the full contract, plan and decision trace.
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
            <div className="flex items-center justify-between gap-space-md">
              <h2
                id="recent-traces"
                className="font-headline-sm text-headline-sm font-semibold text-on-surface"
              >
                Recent task traces
              </h2>
              <Link
                href="/app/tasks/new"
                className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/40 px-space-md py-1.5 font-body-sm text-body-sm text-on-surface transition-colors hover:bg-surface-container-high"
              >
                <Icon name="account_tree" size={14} />
                New task
              </Link>
            </div>
            <TaskTraceTable traces={traces} />
          </section>
        </>
      )}
    </div>
  );
}
