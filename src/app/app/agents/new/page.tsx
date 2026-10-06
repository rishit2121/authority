import type { Metadata } from "next";

import { AgentRegistrationForm } from "@/components/agent/AgentRegistrationForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = {
  title: "Register agent",
};

export default async function NewAgentPage() {
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant("/app/agents/new");

  // A real signed-in tenant member has no guaranteed `principals` row --
  // ensure_onboarded() never creates one (see the migration's own module
  // comment). This lazily ensures the current user's own, resolving to
  // their existing principal if they already have one, so a brand-new
  // workspace owner is never stuck behind an empty Owner picker just to
  // register their first agent.
  const { data: ownPrincipalId } = await context.supabase.rpc("ensure_human_principal_for_current_user", {
    p_tenant_id: identity.tenant.tenantId,
  });

  const principals = await repositories.principals.listByTenant(identity.tenant.tenantId);

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Register agent"
        description="Give your agent an identity so decisions and capabilities can be attributed to it."
      />
      <AgentRegistrationForm principals={principals} defaultOwnerPrincipalId={ownPrincipalId ?? null} />
    </div>
  );
}
