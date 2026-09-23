import { EmptyWorkspace } from "@/components/dashboard/EmptyWorkspace";
import { DemoDataNotice } from "@/components/dashboard/DemoDataNotice";
import { ApprovalDecisionForm } from "@/components/dashboard/ApprovalDecisionForm";
import { Icon } from "@/components/ui/Icon";
import { TENANT_ROLE_LABELS } from "@/lib/auth/tenant-context";
import type { ApprovalStatus } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

const STATUS_CLASSES: Record<ApprovalStatus, string> = {
  pending: "border-secondary/40 bg-secondary/10 text-secondary",
  approved: "border-allow/30 bg-allow/10 text-allow",
  rejected: "border-deny/40 bg-deny/10 text-deny",
  expired: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export default async function ApprovalsPage() {
  const { identity, repositories } = await createRepositoriesForCurrentTenant("/app/approvals");

  const [approvals, principals, tasks] = await Promise.all([
    repositories.approvals.listByTenant(identity.tenant.tenantId),
    repositories.principals.listByTenant(identity.tenant.tenantId),
    repositories.tasks.listByTenant(identity.tenant.tenantId),
  ]);

  const principalName = (id: string) => principals.find((p) => p.id === id)?.displayName ?? "unknown";
  const taskIntent = (id: string) => tasks.find((t) => t.id === id)?.intent ?? "Unknown task";
  const canManageDemoData = identity.role !== "viewer" && TENANT_ROLE_LABELS[identity.role] !== undefined;
  const canDecide =
    identity.role === "security_admin" || identity.role === "admin" || identity.role === "owner";

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Approvals
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Requests that exceeded a verified task boundary and need a human principal to decide. Resolving one
          here records the decision only — it mints no capability and triggers no execution.
        </p>
      </header>

      {approvals.length === 0 ? (
        <EmptyWorkspace />
      ) : (
        <>
          <DemoDataNotice showReset={canManageDemoData} />

          <div className="flex flex-col gap-space-md">
            {approvals.map((approval) => (
              <article
                key={approval.id}
                className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
              >
                <div className="flex flex-wrap items-start justify-between gap-space-md">
                  <div className="min-w-0">
                    <p className="truncate font-mono-code text-[12px] text-primary">{approval.taskId}</p>
                    <p className="mt-0.5 max-w-xl font-body-md text-body-sm text-on-surface-variant">
                      {taskIntent(approval.taskId)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_CLASSES[approval.status]}`}
                  >
                    {approval.status}
                  </span>
                </div>

                <p className="mt-space-md font-body-md text-body-md text-on-surface">{approval.summary}</p>

                <dl className="mt-space-md grid grid-cols-2 gap-space-sm font-body-sm text-body-sm sm:grid-cols-4">
                  <div>
                    <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                      Requested from
                    </dt>
                    <dd className="mt-0.5 text-on-surface-variant">
                      {principalName(approval.requestedFromPrincipalId)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                      Requested
                    </dt>
                    <dd className="mt-0.5 text-on-surface-variant">
                      {new Date(approval.requestedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                      Decided
                    </dt>
                    <dd className="mt-0.5 text-on-surface-variant">
                      {approval.respondedAt
                        ? new Date(approval.respondedAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                      Reason
                    </dt>
                    <dd className="mt-0.5 text-on-surface-variant">{approval.responseNote ?? "—"}</dd>
                  </div>
                </dl>

                {approval.status === "pending" ? (
                  <div className="mt-space-md border-t border-outline-variant/20 pt-space-md">
                    <ApprovalDecisionForm approvalId={approval.id} canDecide={canDecide} />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </>
      )}

      <p className="flex items-center gap-1.5 font-body-sm text-body-sm text-outline">
        <Icon name="lock" size={13} />
        Approving or rejecting here records the human decision only. It does not issue a capability or run
        anything.
      </p>
    </div>
  );
}
