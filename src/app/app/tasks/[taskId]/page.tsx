import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AlignmentFindingsPanel,
  type ContentItemView,
  type FindingView,
  type ReviewView,
} from "@/components/alignment/AlignmentFindingsPanel";
import { GithubTaskPanel, type TaskGithubData } from "@/components/github/GithubTaskPanel";
import type { FlowPhase, FlowStep } from "@/components/github/ExecutionFlowGraph";
import { reconcileExpiredReservations } from "@/lib/gateway/rpc-github";
import { loadRuntimeApprovals, loadTaskGithub } from "@/lib/github/read-model";
import { SemanticShadowPanel, type SemanticPanelRow } from "@/components/semantic/SemanticShadowPanel";
import { ConnectAgentTaskPanel } from "@/components/task/ConnectAgentTaskPanel";
import { TaskBudgetsPanel, type TaskBudgetRow } from "@/components/task/TaskBudgetsPanel";
import { constraintsKey } from "@/lib/authorization/task-budget";
import { TaskInvestigationView } from "@/components/task/TaskInvestigationView";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { loadTaskInvestigation } from "@/lib/data/task";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { EVIDENCE_COLUMNS, GATEWAY_EVIDENCE_COLUMNS, toEvidenceView } from "@/lib/semantic/read-model";

export const metadata: Metadata = {
  title: "Task investigation",
};

/**
 * The dynamic task investigation route.
 *
 * `loadTaskInvestigation` calls `repositories.tasks.findById(taskId)`, which
 * is scoped by this tenant's RLS policies — a task id belonging to another
 * tenant returns no row, indistinguishable from an id that doesn't exist at
 * all. Either way this renders Next's ordinary not-found page, so a stale
 * or guessed task URL from a previous workspace can never reveal that a
 * task exists somewhere else, only that it isn't here.
 */
export default async function TaskInvestigationPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const { repositories, context, identity } = await createRepositoriesForCurrentTenant(
    `/app/tasks/${taskId}`,
  );

  const investigation = await loadTaskInvestigation(taskId, repositories);
  if (!investigation) notFound();

  // Semantic shadow observations, read through the caller's own RLS scope and
  // rendered beside — never merged into — the deterministic decisions.
  const [{ data: legacyRows }, { data: gatewayRows }, { data: decisionRows }] = await Promise.all([
    context.supabase.from("semantic_shadow_evaluations").select(EVIDENCE_COLUMNS).eq("task_id", taskId),
    context.supabase.from("semantic_evaluations").select(GATEWAY_EVIDENCE_COLUMNS).eq("task_id", taskId),
    context.supabase
      .from("authorization_decisions")
      .select("id, outcome, tool_request_id, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const requestIds = (decisionRows ?? []).map((d) => d.tool_request_id);
  const { data: requestRows } = requestIds.length
    ? await context.supabase.from("tool_requests").select("id, tool").in("id", requestIds)
    : { data: [] };
  const toolById = new Map((requestRows ?? []).map((r) => [r.id, r.tool]));
  const evidenceByDecision = new Map(
    [...(legacyRows ?? []), ...(gatewayRows ?? [])].map((r) => [
      r.authorization_decision_id,
      toEvidenceView(r),
    ]),
  );
  const panelRows: SemanticPanelRow[] = (decisionRows ?? []).map((d) => ({
    decisionId: d.id,
    tool: toolById.get(d.tool_request_id) ?? "unknown",
    outcome: d.outcome,
    requestedAt: d.created_at,
    evidence: evidenceByDecision.get(d.id),
  }));

  // Settle any expired execution leases first (best effort) so the panel shows their true state.
  await reconcileExpiredReservations(20).catch(() => undefined);
  // GitHub execution state, read through the caller's own RLS scope.
  const github = await loadTaskGithub(context.supabase, taskId);
  const approvals = await loadRuntimeApprovals(context.supabase, taskId);
  const { data: eventRows } = await context.supabase
    .from("execution_events")
    .select("id, created_at, summary, event_type, normalized_effect_metadata")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })
    .limit(200);
  const FLOW_PHASES = new Set<string>([
    "capability_issued",
    "approval_requested",
    "approval_granted",
    "approval_rejected",
    "approval_stale",
    "capability_issued_after_approval",
    "reserved",
    "dispatched",
    "succeeded",
    "succeeded_noop",
    "failed",
    "indeterminate",
    "released",
  ]);
  const flow: FlowStep[] = (eventRows ?? []).flatMap((e) => {
    const meta = (e.normalized_effect_metadata ?? {}) as { phase?: string; mode?: string };
    if (!meta.phase && e.event_type === "capability_issued") meta.phase = "capability_issued";
    if (!meta.phase || !FLOW_PHASES.has(meta.phase)) return [];
    return [
      {
        id: e.id,
        at: e.created_at,
        phase: meta.phase as FlowPhase,
        summary: e.summary,
        mode: meta.mode === "live" || meta.mode === "mock" ? meta.mode : null,
      },
    ];
  });
  const contractActions = (investigation.contract?.allowedActions ?? [])
    .filter((a) => a.tool.startsWith("github."))
    .map((a) => ({
      tool: a.tool,
      constraints: a.constraints as TaskGithubData["actions"][number]["constraints"],
    }));
  const githubData: TaskGithubData = {
    taskId,
    canBind: ["developer", "security_admin", "admin", "owner"].includes(identity.role),
    canResolve: ["security_admin", "admin", "owner"].includes(identity.role),
    bound: github.boundRepository,
    allowedRepositories: github.allowedRepositories,
    actions: contractActions,
    reservations: github.reservations,
    receipts: github.receipts,
    approvals,
    flow,
  };

  const boundIntegrations = githubData.bound ? [`GitHub · ${githubData.bound.fullName}`] : [];

  const [objectiveRows, reviewRows, itemRows] = await Promise.all([
    context.supabase
      .from("task_objectives")
      .select("version, source, request_text, extraction")
      .eq("task_id", taskId)
      .order("version", { ascending: false })
      .limit(1),
    context.supabase
      .from("alignment_reviews")
      .select(
        "id, kind, mode, policy, outcome, decision, objective_version, context_revision, findings, feedback, usage, created_at",
      )
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(50),
    context.supabase
      .from("external_content_items")
      .select(
        "id, review_id, origin, source_kind, source_label, status, byte_size, content_hash, vault_secret_id, retained_until, created_at",
      )
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const latestObjectives = objectiveRows.data?.[0];
  const extraction = (latestObjectives?.extraction ?? {}) as {
    taskInstructions?: string[];
    prohibitions?: string[];
  };
  const alignmentObjectives = latestObjectives
    ? {
        version: latestObjectives.version,
        source: latestObjectives.source,
        requestText: latestObjectives.request_text,
        taskInstructions: extraction.taskInstructions ?? [],
        prohibitions: extraction.prohibitions ?? [],
      }
    : null;
  const alignmentReviews: ReviewView[] = (reviewRows.data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    mode: r.mode,
    policy: r.policy,
    outcome: r.outcome,
    decision: r.decision,
    objectiveVersion: r.objective_version,
    contextRevision: r.context_revision,
    findings: (Array.isArray(r.findings) ? r.findings : []) as unknown as FindingView[],
    feedback: r.feedback,
    usage: (r.usage ?? null) as ReviewView["usage"],
    createdAt: r.created_at,
  }));
  const contentItems: ContentItemView[] = (itemRows.data ?? []).map((i) => ({
    id: i.id,
    reviewId: i.review_id,
    origin: i.origin,
    sourceKind: i.source_kind,
    sourceLabel: i.source_label,
    status: i.status,
    byteSize: i.byte_size,
    contentHash: i.content_hash,
    retained: Boolean(i.vault_secret_id && i.retained_until && Date.parse(i.retained_until) > Date.now()),
    createdAt: i.created_at,
  }));
  // Task-wide budgets, read through the caller's own RLS scope: the allowance per action and what every contract
  // version of the task has used of it (20261027000001).
  const [{ data: allowanceRows }, { data: usageRows }] = await Promise.all([
    context.supabase
      .from("task_action_allowances")
      .select("tool, resource_constraints, allowance")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
    context.supabase
      .from("capabilities")
      .select("tool, resource_constraints, consumed_uses")
      .eq("task_id", taskId),
  ]);
  const itemsOf = (rc: unknown) => ((rc ?? {}) as { items?: unknown[] }).items ?? [];
  const usedByAction = new Map<string, number>();
  for (const u of usageRows ?? []) {
    const key = `${u.tool} ${constraintsKey(itemsOf(u.resource_constraints))}`;
    usedByAction.set(key, (usedByAction.get(key) ?? 0) + u.consumed_uses);
  }
  const budgetRows: TaskBudgetRow[] = (allowanceRows ?? []).map((a) => {
    const items = itemsOf(a.resource_constraints) as Array<{
      key?: string;
      equals?: string;
      matches?: string;
    }>;
    return {
      tool: a.tool,
      constraintsLabel: items.map((c) => `${c.key} = ${c.equals ?? c.matches ?? ""}`).join(", "),
      allowance: a.allowance,
      used: usedByAction.get(`${a.tool} ${constraintsKey(items)}`) ?? 0,
    };
  });

  const showAlignment =
    Boolean(alignmentObjectives) || alignmentReviews.length > 0 || contentItems.length > 0;

  return (
    <div className="flex flex-col gap-space-lg">
      <TaskInvestigationView investigation={investigation} />
      <ConnectAgentTaskPanel
        taskId={taskId}
        baseUrl={publicBaseUrl() ?? "https://your-authority-deployment.example"}
        contract={investigation.contract}
        boundIntegrations={boundIntegrations}
      />
      {showAlignment ? (
        <AlignmentFindingsPanel
          taskId={taskId}
          objectives={alignmentObjectives}
          reviews={alignmentReviews}
          items={contentItems}
          canDecide={["security_admin", "admin", "owner"].includes(identity.role)}
        />
      ) : null}
      <TaskBudgetsPanel
        taskId={taskId}
        rows={budgetRows}
        canRenew={["admin", "owner"].includes(identity.role)}
      />
      <GithubTaskPanel data={githubData} />
      <SemanticShadowPanel rows={panelRows} />
    </div>
  );
}
