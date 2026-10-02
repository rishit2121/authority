import type { SupabaseClient } from "@supabase/supabase-js";

import type { Id } from "@/lib/domain";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export interface AgentActivity {
  protectedCalls: number;
  lastSeen: string | null;
}

/**
 * Per-agent activity for the Agents list: how many authorization decisions
 * this agent's tool calls have produced, and when it last tried to act.
 * Two tenant-scoped queries total, never one per agent — `tool_requests`
 * carries `agent_id` directly, so decisions only need a second pass to
 * attribute counts back through `tool_request_id`.
 */
export async function loadAgentActivity(
  db: Db,
  tenantId: string,
  agentIds: readonly Id[],
): Promise<Map<Id, AgentActivity>> {
  const activity = new Map<Id, AgentActivity>();
  if (agentIds.length === 0) return activity;

  const { data: requests } = await db
    .from("tool_requests")
    .select("id, agent_id, requested_at")
    .eq("tenant_id", tenantId)
    .in("agent_id", agentIds);

  const lastSeenByAgent = new Map<Id, string>();
  const agentByRequestId = new Map((requests ?? []).map((r) => [r.id, r.agent_id]));
  for (const request of requests ?? []) {
    const current = lastSeenByAgent.get(request.agent_id);
    if (!current || request.requested_at > current)
      lastSeenByAgent.set(request.agent_id, request.requested_at);
  }

  const protectedCallsByAgent = new Map<Id, number>();
  if (agentByRequestId.size > 0) {
    const { data: decisions } = await db
      .from("authorization_decisions")
      .select("tool_request_id")
      .eq("tenant_id", tenantId)
      .in("tool_request_id", Array.from(agentByRequestId.keys()));

    for (const decision of decisions ?? []) {
      const agentId = agentByRequestId.get(decision.tool_request_id);
      if (!agentId) continue;
      protectedCallsByAgent.set(agentId, (protectedCallsByAgent.get(agentId) ?? 0) + 1);
    }
  }

  for (const agentId of agentIds) {
    activity.set(agentId, {
      protectedCalls: protectedCallsByAgent.get(agentId) ?? 0,
      lastSeen: lastSeenByAgent.get(agentId) ?? null,
    });
  }

  return activity;
}

export interface AgentToolCall {
  id: string;
  humanAction: string;
  toolOperation: string;
  resource: string | null;
  outcome: string | null;
  createdAt: string;
}

const AGENT_RECENT_CALLS_LIMIT = 10;

/** The most recent tool calls for one agent's detail page, newest first. */
export async function loadAgentRecentToolCalls(
  db: Db,
  tenantId: string,
  agentId: Id,
): Promise<AgentToolCall[]> {
  const { data: requests } = await db
    .from("tool_requests")
    .select("id, tool, operation, resource, requested_at")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .order("requested_at", { ascending: false })
    .limit(AGENT_RECENT_CALLS_LIMIT);

  if (!requests || requests.length === 0) return [];

  const { data: decisions } = await db
    .from("authorization_decisions")
    .select("tool_request_id, outcome")
    .eq("tenant_id", tenantId)
    .in(
      "tool_request_id",
      requests.map((r) => r.id),
    );
  const outcomeByRequestId = new Map((decisions ?? []).map((d) => [d.tool_request_id, d.outcome]));

  return requests.map((request) => ({
    id: request.id,
    humanAction: `${request.tool} · ${request.operation}`,
    toolOperation: `${request.tool}.${request.operation}`,
    resource: request.resource,
    outcome: outcomeByRequestId.get(request.id) ?? null,
    createdAt: request.requested_at,
  }));
}

export type CredentialStatus = "configured" | "not_configured";

/** Whether each agent has at least one active runtime credential — one batched query. */
export async function loadAgentCredentialStatus(
  db: Db,
  agentIds: readonly Id[],
): Promise<Map<Id, CredentialStatus>> {
  const statusByAgent = new Map<Id, CredentialStatus>();
  if (agentIds.length === 0) return statusByAgent;

  const { data } = await db.from("agent_credentials").select("agent_id, status").in("agent_id", agentIds);

  for (const row of data ?? []) {
    if (row.status === "active") statusByAgent.set(row.agent_id, "configured");
  }
  return statusByAgent;
}
