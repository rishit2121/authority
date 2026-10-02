import type { Metadata } from "next";

import { AgentRegistrationForm } from "@/components/agent/AgentRegistrationForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = {
  title: "Register agent",
};

export default async function NewAgentPage() {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/agents/new");
  const principals = await repositories.principals.listByTenant(identity.tenant.tenantId);

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Register agent"
        description="Give your agent an identity so decisions and capabilities can be attributed to it."
      />
      <AgentRegistrationForm principals={principals} />
    </div>
  );
}
