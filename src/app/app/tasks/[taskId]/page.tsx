import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SemanticShadowPanel, type SemanticPanelRow } from "@/components/semantic/SemanticShadowPanel";
import { TaskInvestigationView } from "@/components/task/TaskInvestigationView";
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
  const { repositories, context } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}`);

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

  return (
    <div className="flex flex-col gap-space-lg">
      <TaskInvestigationView investigation={investigation} />
      <SemanticShadowPanel rows={panelRows} />
    </div>
  );
}
