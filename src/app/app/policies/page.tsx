import { EmptyWorkspace } from "@/components/dashboard/EmptyWorkspace";
import { DemoDataNotice } from "@/components/dashboard/DemoDataNotice";
import { Icon } from "@/components/ui/Icon";
import { TENANT_ROLE_LABELS } from "@/lib/auth/tenant-context";
import type { PolicyStatus } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

const STATUS_CLASSES: Record<PolicyStatus, string> = {
  draft: "border-secondary/40 bg-secondary/10 text-secondary",
  active: "border-allow/30 bg-allow/10 text-allow",
  archived: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export default async function PoliciesPage() {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/policies");
  const policies = await repositories.policies.listByTenant(identity.tenant.tenantId);
  const canManageDemoData = identity.role !== "viewer" && TENANT_ROLE_LABELS[identity.role] !== undefined;

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Policies
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Deterministic organization policy: hard denials, resource ceilings and approval routing rules,
          evaluated alongside every task&apos;s own contract.
        </p>
      </header>

      {policies.length === 0 ? (
        <EmptyWorkspace />
      ) : (
        <>
          <DemoDataNotice showReset={canManageDemoData} />

          <p className="font-body-sm text-body-sm text-outline">
            Activated policy versions are immutable at the database level — changing one requires creating a
            new version, never editing this row. Activating a draft is a later phase; every policy below is
            read-only from this page for now.
          </p>

          <div className="flex flex-col gap-space-md">
            {policies.map((policy) => (
              <article
                key={policy.id}
                className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
              >
                <div className="flex flex-wrap items-start justify-between gap-space-md">
                  <div>
                    <h2 className="flex items-center gap-2 font-headline-sm text-headline-sm font-semibold text-on-surface">
                      <Icon name="policy" size={16} className="text-outline" />
                      {policy.name}
                    </h2>
                    {policy.description ? (
                      <p className="mt-1 max-w-xl font-body-md text-body-sm text-on-surface-variant">
                        {policy.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-space-sm">
                    <span className="font-mono-token text-[11px] uppercase tracking-wider text-outline">
                      v{policy.version}
                    </span>
                    <span
                      className={`inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_CLASSES[policy.status]}`}
                    >
                      {policy.status}
                    </span>
                    <span
                      className={`inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px] ${
                        policy.effect === "deny"
                          ? "border-deny/40 bg-deny/10 text-deny"
                          : "border-allow/30 bg-allow/10 text-allow"
                      }`}
                    >
                      {policy.effect}
                    </span>
                  </div>
                </div>
                <dl className="mt-space-md grid grid-cols-2 gap-space-sm font-body-sm text-body-sm sm:grid-cols-3">
                  <div>
                    <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                      Created
                    </dt>
                    <dd className="mt-0.5 text-on-surface-variant">
                      {new Date(policy.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                      Activated
                    </dt>
                    <dd className="mt-0.5 text-on-surface-variant">
                      {policy.activatedAt
                        ? new Date(policy.activatedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "Not activated"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
