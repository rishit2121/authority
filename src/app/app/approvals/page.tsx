import { ApprovalPolicyForm, RuntimeApprovalsPanel } from "@/components/github/RuntimeApprovalsPanel";
import { loadRuntimeApprovals } from "@/lib/github/read-model";
import { ApprovalDecisionForm } from "@/components/dashboard/ApprovalDecisionForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { loadApprovalRequestContext } from "@/lib/data/approvals";
import type { ApprovalStatus } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

const STATUS_TONE: Record<ApprovalStatus, StatusTone> = {
  pending: "attention",
  approved: "positive",
  rejected: "negative",
  expired: "muted",
};

function requestAge(requestedAt: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(requestedAt)) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export default async function ApprovalsPage() {
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant("/app/approvals");

  const runtimeApprovals = await loadRuntimeApprovals(context.supabase);
  const { data: policyRow } = await context.supabase
    .from("semantic_settings")
    .select("runtime_approval_classes")
    .maybeSingle();
  const [allApprovals, tasks] = await Promise.all([
    repositories.approvals.listByTenant(identity.tenant.tenantId),
    repositories.tasks.listByTenant(identity.tenant.tenantId),
  ]);

  // Decision-bound only: a runtime tool-call exception, resolved with
  // ApprovalDecisionForm's plain approve/reject via resolveApprovalAction.
  // Contract-bound approval slots (Part 3B) are a different concept entirely
  // — required *before* a contract may ever activate, bound to an exact
  // contract/plan/hash identity, decided via decideContractApprovalAction —
  // and have their own dedicated panel on the task page. Showing them here
  // too, through a decision form that doesn't know about slots, roles or
  // self-approval, would be actively misleading: RLS silently refuses the
  // direct-UPDATE path that form uses for any contract-bound row.
  const approvals = allApprovals.filter((a) => !a.contractId);
  const requestContext = await loadApprovalRequestContext(
    context.supabase,
    identity.tenant.tenantId,
    approvals.map((a) => a.decisionId).filter((id): id is string => Boolean(id)),
  );

  const taskIntent = (id: string) => tasks.find((t) => t.id === id)?.intent ?? "Unknown task";
  const canDecide =
    identity.role === "security_admin" || identity.role === "admin" || identity.role === "owner";

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Approvals"
        description="Requests that need a person before authority can be issued."
      />

      <RuntimeApprovalsPanel approvals={runtimeApprovals} canDecide={canDecide} />
      <ApprovalPolicyForm initial={policyRow?.runtime_approval_classes ?? []} canEdit={canDecide} />

      <section aria-labelledby="tool-call-approvals" className="flex flex-col gap-3">
        <h2 id="tool-call-approvals" className="text-[15px] font-semibold text-ink">
          Tool-call approvals
        </h2>

        {approvals.length === 0 ? (
          <EmptyState
            icon="verified_user"
            heading="No requests waiting"
            description="All current requests have been resolved or did not require human review. This is a healthy state, not an error."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {approvals.map((approval) => {
              const request = approval.decisionId ? requestContext.get(approval.decisionId) : undefined;
              return (
                <article key={approval.id} className="rounded-[10px] border border-line bg-paper-raised p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] text-ink">{approval.summary}</p>
                      <p className="mt-0.5 max-w-xl text-[13px] text-ink-soft">
                        {taskIntent(approval.taskId)}
                      </p>
                    </div>
                    <StatusPill tone={STATUS_TONE[approval.status]}>
                      {STATUS_LABEL[approval.status]}
                    </StatusPill>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-ink-soft">Agent</dt>
                      <dd className="mt-0.5 text-ink">{request?.agentName ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-ink-soft">Exact resource</dt>
                      <dd className="mt-0.5 break-all font-mono-code text-[12px] text-ink">
                        {request?.resource ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-ink-soft">
                        Approver requirement
                      </dt>
                      <dd className="mt-0.5 text-ink">Security administrator or above</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-ink-soft">Request age</dt>
                      <dd className="mt-0.5 font-mono-code text-[12px] text-ink-soft">
                        {requestAge(approval.requestedAt)}
                      </dd>
                    </div>
                  </dl>

                  {approval.status === "pending" ? (
                    <div className="mt-4 border-t border-line pt-4">
                      <ApprovalDecisionForm approvalId={approval.id} canDecide={canDecide} />
                    </div>
                  ) : approval.responseNote ? (
                    <p className="mt-4 border-t border-line pt-4 text-[13px] text-ink-soft">
                      {approval.responseNote}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <p className="flex items-center gap-1.5 text-[13px] text-ink-soft">
        <Icon name="lock" size={13} />
        Approving or rejecting here records the human decision only. It does not issue a capability or run
        anything.
      </p>
    </div>
  );
}
