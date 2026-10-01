import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import type { IntegrationStatus } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

const STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: "Connected",
  warning: "Needs attention",
  not_connected: "Not connected",
};

const STATUS_TONE: Record<IntegrationStatus, StatusTone> = {
  connected: "positive",
  warning: "attention",
  not_connected: "muted",
};

export default async function IntegrationsPage() {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/integrations");
  const integrations = await repositories.integrations.listByTenant(identity.tenant.tenantId);

  // GitHub's authoritative, live (mock-execution) status lives on its own
  // connector page and card below — this generic table is simulated registry
  // metadata only, so GitHub's row here would otherwise contradict that card.
  const registryTools = integrations.filter((integration) => integration.provider !== "github");

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Integrations"
        description="Connect the services agents may access through Authority."
      />

      <section aria-labelledby="connected-integrations" className="flex flex-col gap-3">
        <h2 id="connected-integrations" className="text-[15px] font-semibold text-ink">
          Connected integrations
        </h2>
        <Link
          href="/app/integrations/github"
          data-testid="github-integration-link"
          className="flex items-center justify-between rounded-[10px] border border-line bg-paper-raised p-5 transition-colors hover:bg-black/[0.02]"
        >
          <span>
            <h3 className="text-[15px] font-semibold text-ink">GitHub connector</h3>
            <span className="block text-[13px] text-ink-soft">
              Install the GitHub App, allow repositories and bind tasks. Real, least-privilege execution.
            </span>
          </span>
          <Icon name="arrow_forward" size={16} className="text-ink-soft" />
        </Link>
      </section>

      {integrations.length === 0 ? (
        <EmptyState
          icon="token"
          heading="No integrations configured"
          description="Connect GitHub to let agents act on real repositories under least-privilege authority."
        />
      ) : (
        <section aria-labelledby="available-tools" className="flex flex-col gap-3">
          <h2 id="available-tools" className="text-[15px] font-semibold text-ink">
            Available tools
          </h2>

          <div
            role="note"
            className="flex items-start gap-2.5 rounded-lg border border-line bg-paper px-3.5 py-2.5"
          >
            <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-ink-soft" />
            <p className="text-[13px] text-ink-soft">
              Simulated metadata only. No OAuth token, password, API key or other credential is collected or
              stored here — there is no &quot;Connect&quot; action that reaches a real provider yet.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {registryTools.map((integration) => (
              <article
                key={integration.id}
                className="flex flex-col gap-2 rounded-[10px] border border-line bg-paper-raised p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-[14px] font-semibold capitalize text-ink">
                    <Icon name="token" size={15} className="text-ink-soft" />
                    {integration.provider}
                  </h3>
                  <StatusPill tone={STATUS_TONE[integration.status]}>
                    {STATUS_LABELS[integration.status]}
                  </StatusPill>
                </div>
                <p className="text-[13px] text-ink-soft">{integration.displayName}</p>
                <p className="text-[11px] text-ink-soft">
                  Available in the tool registry · No live connector configured
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
