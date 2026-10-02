import Link from "next/link";

import { EmptyWorkspace } from "@/components/dashboard/EmptyWorkspace";
import { DemoDataNotice } from "@/components/dashboard/DemoDataNotice";
import { Icon } from "@/components/ui/Icon";
import { TENANT_ROLE_LABELS } from "@/lib/auth/tenant-context";
import type { IntegrationStatus } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

const STATUS_CLASSES: Record<IntegrationStatus, string> = {
  connected: "border-allow/30 bg-allow/10 text-allow",
  warning: "border-secondary/40 bg-secondary/10 text-secondary",
  not_connected: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

const STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: "Connected",
  warning: "Needs attention",
  not_connected: "Not connected",
};

export default async function IntegrationsPage() {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/integrations");
  const integrations = await repositories.integrations.listByTenant(identity.tenant.tenantId);
  const canManageDemoData = identity.role !== "viewer" && TENANT_ROLE_LABELS[identity.role] !== undefined;

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Integrations
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Connected tool provider metadata and the credentials Authority isolates on their behalf.
        </p>
      </header>

      <Link
        href="/app/integrations/github"
        data-testid="github-integration-link"
        className="flex items-center justify-between rounded-xl border border-primary/30 bg-surface-container p-space-lg transition-colors hover:bg-surface-container-high"
      >
        <span>
          <span className="block font-headline-sm text-body-lg font-semibold text-on-surface">
            GitHub connector
          </span>
          <span className="block font-body-sm text-body-sm text-on-surface-variant">
            Install the GitHub App, allow repositories and bind tasks. Real, least-privilege execution.
          </span>
        </span>
        <Icon name="arrow_forward" size={16} />
      </Link>

      <Link
        href="/app/integrations/custom-api"
        data-testid="custom-api-integration-link"
        className="flex items-center justify-between rounded-xl border border-primary/30 bg-surface-container p-space-lg transition-colors hover:bg-surface-container-high"
      >
        <span>
          <span className="block font-headline-sm text-body-lg font-semibold text-on-surface">
            Custom API connector
          </span>
          <span className="block font-body-sm text-body-sm text-on-surface-variant">
            Connect any HTTPS API your tenant controls, define schema-constrained operations, and publish them
            once validated. Real, SSRF-protected execution.
          </span>
        </span>
        <Icon name="arrow_forward" size={16} />
      </Link>

      {integrations.length === 0 ? (
        <EmptyWorkspace />
      ) : (
        <>
          <DemoDataNotice showReset={canManageDemoData} />

          <div
            role="note"
            className="flex items-start gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2.5"
          >
            <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-outline" />
            <p className="font-body-md text-body-sm text-on-surface-variant">
              Simulated metadata only. No OAuth token, password, API key or other credential is collected or
              stored here — there is no &quot;Connect&quot; action that reaches a real provider yet.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-3">
            {integrations.map((integration) => (
              <article
                key={integration.id}
                className="flex flex-col gap-space-sm rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
              >
                <div className="flex items-center justify-between gap-space-sm">
                  <h2 className="flex items-center gap-2 font-headline-sm text-body-lg font-semibold capitalize text-on-surface">
                    <Icon name="token" size={16} className="text-outline" />
                    {integration.provider}
                  </h2>
                  <span
                    className={`inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_CLASSES[integration.status]}`}
                  >
                    {STATUS_LABELS[integration.status]}
                  </span>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant">{integration.displayName}</p>
                <p className="mt-auto font-mono-code text-[11px] text-outline">
                  Added{" "}
                  {new Date(integration.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
