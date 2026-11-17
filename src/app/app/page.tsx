import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { EmptyWorkspace } from "@/components/dashboard/EmptyWorkspace";
import { DecisionStatusBadge } from "@/components/ui/DecisionStatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusRow } from "@/components/ui/StatusRow";
import { demoDataEnabled } from "@/lib/demo-data";
import type { DecisionStatus } from "@/lib/domain";
import {
  loadDashboardOverview,
  loadRecentToolCalls,
  loadTasksNeedingAttention,
  type TaskNeedingAttention,
} from "@/lib/data/dashboard";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/**
 * Setup is done once this workspace has made at least one ALLOWED protected call -- through the Setup page's own
 * call or the developer's code, whichever came first. Read under RLS from authorization_decisions (the record every
 * authorize writes), ignoring seeded demo rows. A setup task that was blocked, never authorized, or only created
 * does not count, and a team that integrated without the Setup page is not nagged.
 */
async function hasAllowedProtectedCall(db: Db): Promise<boolean> {
  const { data } = await db
    .from("authorization_decisions")
    .select("id")
    .in("outcome", ["allow", "allow_constrained"])
    .is("demo_key", null)
    .limit(1);
  return (data ?? []).length > 0;
}

function SetupCard() {
  return (
    <section
      className="flex flex-col gap-4 rounded-[14px] border border-line-strong bg-paper-raised p-6 sm:flex-row sm:items-center sm:justify-between"
      data-testid="setup-card"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold text-ink">Finish setting up Authority</h2>
        <p className="text-[14px] text-ink-soft">
          Connect a service, make one real protected call, then copy the code into your app.
        </p>
      </div>
      <Link
        href="/app/setup"
        className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-fixed"
      >
        Continue setup
        <Icon name="arrow_forward" size={16} />
      </Link>
    </section>
  );
}

const ATTENTION_REASON_LABEL: Record<TaskNeedingAttention["reason"], string> = {
  failed: "Failed",
  awaiting_approval: "Awaiting approval",
  contract_expired: "Contract expired",
};

export default async function OverviewPage() {
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant("/app");
  const db = context.supabase;

  const [setupComplete, overview] = await Promise.all([
    hasAllowedProtectedCall(db),
    loadDashboardOverview(repositories, identity.tenant.tenantId),
  ]);
  const { metrics, traces, hasAnyProductData } = overview;

  const [recentToolCalls, tasksNeedingAttention] = await Promise.all([
    loadRecentToolCalls(db, identity.tenant.tenantId),
    loadTasksNeedingAttention(repositories, traces),
  ]);

  const metricById = (id: string) => metrics.find((m) => m.id === id)?.value ?? 0;

  return (
    <div className="flex flex-col gap-space-xl">
      <PageHeader
        eyebrow={identity.tenant.name}
        title="Overview"
        description="What your agents did recently, and anything that needs you."
      />

      {setupComplete ? null : <SetupCard />}

      {!hasAnyProductData ? (
        demoDataEnabled() ? (
          <EmptyWorkspace />
        ) : null
      ) : (
        <>
          <StatusRow
            items={[
              { label: "Active agents", value: metricById("active-agents") },
              { label: "Protected tool calls", value: metricById("protected-calls") },
              { label: "Denied requests", value: metricById("blocked-requests"), emphasis: "attention" },
              { label: "Pending approvals", value: metricById("pending-approvals") },
            ]}
          />

          <section aria-labelledby="recent-tool-calls" className="flex flex-col gap-space-md">
            <div className="flex items-center justify-between gap-space-md">
              <h2 id="recent-tool-calls" className="text-[17px] font-semibold text-ink">
                Recent tool calls
              </h2>
              <Link
                href="/app/runtime"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03]"
              >
                View all tool calls
              </Link>
            </div>
            {recentToolCalls.length === 0 ? (
              <EmptyState
                icon="bolt"
                heading="No tool calls yet"
                description="Authorization requests from registered agents will appear here."
              />
            ) : (
              <div className="overflow-hidden rounded-[10px] border border-line bg-paper-raised">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Recent tool calls</caption>
                  <tbody>
                    {recentToolCalls.map((call) => (
                      <tr key={call.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-3">
                          <div className="text-[14px] text-ink">{call.agentName}</div>
                          <div className="mt-0.5 font-mono-code text-[11px] text-ink-soft">
                            {call.toolOperation}
                            {call.resource ? ` · ${call.resource}` : ""}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <DecisionStatusBadge status={call.outcome as DecisionStatus} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono-code text-[11px] text-ink-soft">
                          {new Date(call.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="needs-attention" className="flex flex-col gap-space-md">
            <h2 id="needs-attention" className="text-[17px] font-semibold text-ink">
              Tasks needing attention
            </h2>
            {tasksNeedingAttention.length === 0 ? (
              <p className="text-[14px] text-ink-soft">No tasks need attention.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line bg-paper-raised">
                {tasksNeedingAttention.map((item) => (
                  <li key={item.task.id}>
                    <Link
                      href={`/app/tasks/${item.task.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-black/[0.02]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] text-ink">{item.task.intent}</span>
                        <span className="mt-0.5 block text-[12px] text-ink-soft">{item.agentName}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-[12px] font-medium text-deny">
                        {ATTENTION_REASON_LABEL[item.reason]}
                        <Icon name="arrow_forward" size={14} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
