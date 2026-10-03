import Link from "next/link";
import { notFound } from "next/navigation";

import { AgentCredentialsPanel, type AgentCredentialRow } from "@/components/agent/AgentCredentialsPanel";
import { ConnectAgentPanel } from "@/components/agent/ConnectAgentPanel";
import { DecisionStatusBadge } from "@/components/ui/DecisionStatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { loadAgentRecentToolCalls } from "@/lib/data/agents";
import type { AgentStatus, DecisionStatus } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  active: "Active",
  paused: "Paused",
  revoked: "Revoked",
};

const AGENT_STATUS_TONE: Record<AgentStatus, StatusTone> = {
  active: "positive",
  paused: "attention",
  revoked: "negative",
};

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant(
    `/app/agents/${agentId}`,
  );

  const agent = await repositories.agents.findById(agentId);
  if (!agent || agent.tenantId !== identity.tenant.tenantId) notFound();

  const [principal, assignedTasksPage, recentToolCalls, credentialsResult] = await Promise.all([
    repositories.principals.findById(agent.ownerPrincipalId),
    repositories.tasks.listByTenantPaged(identity.tenant.tenantId, { limit: 10 }, { agentId }),
    loadAgentRecentToolCalls(context.supabase, identity.tenant.tenantId, agentId),
    context.supabase
      .from("agent_credentials")
      .select("id, key_prefix, status, created_at, last_used_at, revoked_at, revocation_reason")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false }),
  ]);

  if (credentialsResult.error) {
    // RLS scopes this to security_admin+; a lower role sees an empty list
    // rather than an error, matching how the rest of this app degrades.
    console.error("agent detail: could not load credentials", credentialsResult.error.message);
  }

  const credentials: AgentCredentialRow[] = (credentialsResult.data ?? []).map((row) => ({
    id: row.id,
    keyPrefix: row.key_prefix,
    status: row.status,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason,
  }));

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        eyebrow={principal ? `Owned by ${principal.displayName}` : undefined}
        title={agent.name}
        description={`${agent.model} on ${agent.framework}.`}
      >
        <StatusPill tone={AGENT_STATUS_TONE[agent.status]}>{AGENT_STATUS_LABEL[agent.status]}</StatusPill>
      </PageHeader>

      <AgentCredentialsPanel agentId={agentId} credentials={credentials} />

      <ConnectAgentPanel baseUrl={publicBaseUrl() ?? "https://your-authority-deployment.example"} />

      <section aria-labelledby="recent-tool-calls" className="flex flex-col gap-3">
        <h2 id="recent-tool-calls" className="text-[15px] font-semibold text-ink">
          Recent tool calls
        </h2>
        {recentToolCalls.length === 0 ? (
          <EmptyState
            icon="bolt"
            heading="No tool calls yet"
            description="Authorization requests from this agent will appear here."
          />
        ) : (
          <div className="overflow-hidden rounded-[10px] border border-line bg-paper-raised">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Recent tool calls from this agent</caption>
              <tbody>
                {recentToolCalls.map((call) => (
                  <tr key={call.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="font-mono-code text-[12px] text-ink">{call.toolOperation}</span>
                      {call.resource ? (
                        <span className="ml-1.5 text-[12px] text-ink-soft">{call.resource}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {call.outcome ? <DecisionStatusBadge status={call.outcome as DecisionStatus} /> : null}
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

      <section aria-labelledby="assigned-tasks" className="flex flex-col gap-3">
        <h2 id="assigned-tasks" className="text-[15px] font-semibold text-ink">
          Assigned tasks
        </h2>
        {assignedTasksPage.items.length === 0 ? (
          <EmptyState
            icon="account_tree"
            heading="No tasks assigned"
            description="Tasks delegated to this agent will appear here."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line bg-paper-raised">
            {assignedTasksPage.items.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/app/tasks/${task.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-black/[0.02]"
                >
                  <span className="min-w-0 truncate text-[14px] text-ink">{task.intent}</span>
                  <span className="shrink-0 font-mono-code text-[11px] text-ink-soft">
                    {task.status.replace(/_/g, " ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="configuration" className="flex flex-col gap-3">
        <h2 id="configuration" className="text-[15px] font-semibold text-ink">
          Configuration
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-[10px] border border-line bg-paper-raised p-4 sm:grid-cols-2">
          <div>
            <dt className="text-[12px] text-ink-soft">Model</dt>
            <dd className="mt-0.5 text-[14px] text-ink">{agent.model}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-soft">Framework</dt>
            <dd className="mt-0.5 text-[14px] text-ink">{agent.framework}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-soft">Owner</dt>
            <dd className="mt-0.5 text-[14px] text-ink">{principal?.displayName ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-soft">Registered</dt>
            <dd className="mt-0.5 font-mono-code text-[12px] text-ink-soft">
              {new Date(agent.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
