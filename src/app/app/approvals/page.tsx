import { ApprovalPolicyForm, RuntimeApprovalsPanel } from "@/components/github/RuntimeApprovalsPanel";
import { loadRuntimeApprovals } from "@/lib/github/read-model";
import Link from "next/link";

import { ApprovalDecisionForm } from "@/components/dashboard/ApprovalDecisionForm";
import { ApprovalRulesPanel, type ApprovalRuleView } from "@/components/dashboard/ApprovalRulesPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { loadApprovalRequestContext } from "@/lib/data/approvals";
import type { ApprovalStatus } from "@/lib/domain";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { buildTenantRegistry } from "@/lib/registry";

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
  const [allApprovals, tasks, policies, registry, waitingResult, alignmentResult] = await Promise.all([
    repositories.approvals.listByTenant(identity.tenant.tenantId),
    repositories.tasks.listByTenant(identity.tenant.tenantId),
    repositories.policies.listByTenant(identity.tenant.tenantId),
    buildTenantRegistry(identity.tenant.tenantId),
    context.supabase
      .from("task_authority_contracts")
      .select("id, task_id, required_approvals_spec, created_at")
      .in("contract_status", ["proposed", "awaiting_approval"])
      .order("created_at", { ascending: false })
      .limit(50),
    context.supabase
      .from("alignment_reviews")
      .select("id, task_id, kind, outcome, findings, created_at")
      .eq("mode", "enforce")
      .is("decision", null)
      .in("outcome", ["misaligned", "ambiguous", "unreviewed"])
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const alignmentHolds = (alignmentResult.data ?? []).map((r) => {
    const findings = (Array.isArray(r.findings) ? r.findings : []) as {
      explanation?: string;
      severity?: string;
    }[];
    return {
      id: r.id,
      taskId: r.task_id,
      kind: r.kind,
      outcome: r.outcome,
      summary:
        findings.find((f) => f.severity !== "info")?.explanation ??
        "Task-alignment review did not clear this.",
    };
  });

  const rules: ApprovalRuleView[] = policies
    .filter((p) => p.effect === "require_approval" && p.status === "active" && p.conditions.length > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      key: p.conditions[0].key,
      matches: p.conditions[0].matches,
      role: p.requiredApprovalRole ?? "admin",
    }));
  const toolIds = [...registry.operations.keys()].sort();
  // Contracts a rule is holding: proposed, with a non-empty approval requirement.
  const waiting = (waitingResult.data ?? []).flatMap((c) => {
    const items = (c.required_approvals_spec as { items?: { reasons?: string[] }[] } | null)?.items;
    if (!Array.isArray(items) || items.length === 0) return [];
    return [{ id: c.id, taskId: c.task_id, reasons: items.flatMap((i) => i.reasons ?? []) }];
  });

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
      <PageHeader title="Approvals" description="Decide what needs a person, and act on anything waiting." />

      <ApprovalRulesPanel rules={rules} tools={toolIds} canEdit={canDecide} />

      <RuntimeApprovalsPanel approvals={runtimeApprovals} canDecide={canDecide} />
      <ApprovalPolicyForm initial={policyRow?.runtime_approval_classes ?? []} canEdit={canDecide} />

      <section aria-labelledby="tool-call-approvals" className="flex flex-col gap-3">
        <h2 id="tool-call-approvals" className="text-[15px] font-semibold text-ink">
          Tool-call approvals
        </h2>

        {approvals.length === 0 && waiting.length === 0 && alignmentHolds.length === 0 ? (
          <EmptyState
            icon="verified_user"
            heading="No requests waiting"
            description="All current requests have been resolved or did not require human review. This is a healthy state, not an error."
          />
        ) : (
          <div className="flex flex-col gap-3" data-testid="approvals-list">
            {alignmentHolds.map((h) => (
              <article
                key={h.id}
                className="rounded-[10px] border border-line bg-paper-raised p-5"
                data-testid="alignment-hold"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-ink">{taskIntent(h.taskId)}</p>
                    <p className="mt-0.5 max-w-xl text-[13px] text-ink-soft">
                      {h.kind === "plan" ? "Plan" : h.kind === "content" ? "External content" : "Tool call"}{" "}
                      {h.outcome}: {h.summary}
                    </p>
                  </div>
                  <StatusPill tone="attention">Task alignment</StatusPill>
                </div>
                <div className="mt-4 border-t border-line pt-4">
                  <Link
                    href={`/app/tasks/${h.taskId}`}
                    className="text-[13px] font-medium text-signal hover:underline"
                  >
                    Review findings →
                  </Link>
                  <Link
                    href="/docs/task-alignment#findings"
                    className="ml-4 text-[13px] text-ink-soft hover:underline"
                  >
                    What this means
                  </Link>
                </div>
              </article>
            ))}
            {waiting.map((c) => (
              <article key={c.id} className="rounded-[10px] border border-line bg-paper-raised p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-ink">{taskIntent(c.taskId)}</p>
                    <p className="mt-0.5 max-w-xl text-[13px] text-ink-soft">
                      {c.reasons.join("; ") || "An approval rule matched this task."}
                    </p>
                  </div>
                  <StatusPill tone="attention">Pending</StatusPill>
                </div>
                <div className="mt-4 border-t border-line pt-4">
                  <Link
                    href={`/app/tasks/${c.taskId}`}
                    className="text-[13px] font-medium text-signal hover:underline"
                  >
                    Review and approve →
                  </Link>
                </div>
              </article>
            ))}
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
