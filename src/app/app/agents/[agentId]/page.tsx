import { notFound } from "next/navigation";

import { AgentCredentialsPanel, type AgentCredentialRow } from "@/components/agent/AgentCredentialsPanel";
import { Icon } from "@/components/ui/Icon";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant(
    `/app/agents/${agentId}`,
  );

  const agent = await repositories.agents.findById(agentId);
  if (!agent || agent.tenantId !== identity.tenant.tenantId) notFound();

  const { data: credentialRows, error } = await context.supabase
    .from("agent_credentials")
    .select("id, key_prefix, status, created_at, last_used_at, revoked_at, revocation_reason")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });

  if (error) {
    // RLS scopes this to security_admin+; a lower role sees an empty list
    // rather than an error, matching how the rest of this app degrades.
    console.error("agent detail: could not load credentials", error.message);
  }

  const credentials: AgentCredentialRow[] = (credentialRows ?? []).map((row) => ({
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
      <header>
        <h1 className="flex items-center gap-2 font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          <Icon name="smart_toy" size={22} className="text-outline" />
          {agent.name}
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          {agent.model} on {agent.framework} · status {agent.status}
        </p>
      </header>

      <AgentCredentialsPanel agentId={agentId} credentials={credentials} />
    </div>
  );
}
