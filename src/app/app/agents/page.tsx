import { AgentsTable, type AgentRow } from "@/components/dashboard/AgentsTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { loadAgentActivity, loadAgentCredentialStatus } from "@/lib/data/agents";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export default async function AgentsPage() {
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant("/app/agents");

  const [agents, principals] = await Promise.all([
    repositories.agents.listByTenant(identity.tenant.tenantId),
    repositories.principals.listByTenant(identity.tenant.tenantId),
  ]);

  const agentIds = agents.map((a) => a.id);
  const [activityByAgent, credentialByAgent] = await Promise.all([
    loadAgentActivity(context.supabase, identity.tenant.tenantId, agentIds),
    loadAgentCredentialStatus(context.supabase, agentIds),
  ]);

  const ownerName = (id: string) => principals.find((p) => p.id === id)?.displayName ?? "Unknown";

  const rows: AgentRow[] = agents.map((agent) => ({
    agent,
    ownerName: ownerName(agent.ownerPrincipalId),
    credentialStatus: credentialByAgent.get(agent.id) ?? "not_configured",
    protectedCalls: activityByAgent.get(agent.id)?.protectedCalls ?? 0,
    lastSeen: activityByAgent.get(agent.id)?.lastSeen ?? null,
  }));

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Agents"
        description="Agents registered to request authority from this workspace."
        primaryAction={{ label: "Register agent", href: "/app/agents/new" }}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="smart_toy"
          heading="No agents registered"
          description="Register an agent before creating a protected task."
          action={{ label: "Register agent", href: "/app/agents/new" }}
        />
      ) : (
        <AgentsTable rows={rows} />
      )}
    </div>
  );
}
