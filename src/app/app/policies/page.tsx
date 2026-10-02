import { PoliciesTable } from "@/components/dashboard/PoliciesTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export default async function PoliciesPage() {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/policies");
  const policies = await repositories.policies.listByTenant(identity.tenant.tenantId);

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Policies"
        description="Deterministic rules that constrain tasks and tool calls."
        primaryAction={{ label: "Create policy", href: "/app/policies/new" }}
      />

      {policies.length === 0 ? (
        <EmptyState
          icon="policy"
          heading="No policies yet"
          description="Policies constrain what any task's contract may ever request, regardless of what it proposes."
        />
      ) : (
        <PoliciesTable policies={policies} />
      )}
    </div>
  );
}
