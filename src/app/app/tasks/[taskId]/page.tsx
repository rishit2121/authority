import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GithubTaskPanel, type TaskGithubData } from "@/components/github/GithubTaskPanel";
import type { FlowPhase, FlowStep } from "@/components/github/ExecutionFlowGraph";
import { reconcileExpiredReservations } from "@/lib/gateway/rpc-github";
import { loadRuntimeApprovals, loadTaskGithub } from "@/lib/github/read-model";
import { SemanticShadowPanel, type SemanticPanelRow } from "@/components/semantic/SemanticShadowPanel";
import { ConnectAgentTaskPanel } from "@/components/task/ConnectAgentTaskPanel";
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

  return (
    <div className="flex flex-col gap-space-lg">
      <TaskInvestigationView investigation={investigation} />
      <ConnectAgentTaskPanel
        taskId={taskId}
        baseUrl={publicBaseUrl() ?? "https://your-authority-deployment.example"}
        contract={investigation.contract}
        boundIntegrations={boundIntegrations}
      />
      <GithubTaskPanel data={githubData} />
      <SemanticShadowPanel rows={panelRows} />
    </div>
  );
}
