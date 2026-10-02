import type { SupabaseClient } from "@supabase/supabase-js";

import type { Id } from "@/lib/domain";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export interface ApprovalRequestContext {
  agentName: string;
  toolOperation: string;
  resource: string | null;
}

/**
 * What a decision-bound approval's request actually was: joins
 * `authorization_decisions` -> `tool_requests` -> `agents`, two batched
 * queries regardless of how many approvals are pending.
 */
export async function loadApprovalRequestContext(
  db: Db,
  tenantId: string,
  decisionIds: readonly Id[],
): Promise<Map<Id, ApprovalRequestContext>> {
  const context = new Map<Id, ApprovalRequestContext>();
  if (decisionIds.length === 0) return context;

  const { data: decisions } = await db
    .from("authorization_decisions")
    .select("id, tool_request_id")
    .eq("tenant_id", tenantId)
    .in("id", decisionIds);
  if (!decisions || decisions.length === 0) return context;

  const { data: requests } = await db
    .from("tool_requests")
    .select("id, tool, operation, resource, agent_id")
    .eq("tenant_id", tenantId)
    .in(
      "id",
      decisions.map((d) => d.tool_request_id),
    );
  const requestById = new Map((requests ?? []).map((r) => [r.id, r]));

  const agentIds = Array.from(new Set((requests ?? []).map((r) => r.agent_id)));
  const { data: agents } = agentIds.length
    ? await db.from("agents").select("id, name").in("id", agentIds)
    : { data: [] as { id: string; name: string }[] };
  const agentNameById = new Map((agents ?? []).map((a) => [a.id, a.name]));

  for (const decision of decisions) {
    const request = requestById.get(decision.tool_request_id);
    if (!request) continue;
    context.set(decision.id, {
      agentName: agentNameById.get(request.agent_id) ?? "Unknown agent",
      toolOperation: `${request.tool}.${request.operation}`,
      resource: request.resource,
    });
  }

  return context;
}
