import { presentDecisionStatus } from "@/lib/authorization/decision-status";
import type { DecisionStatus } from "@/lib/domain";
import { summarizeReasonCodes } from "@/lib/runtime/reason-codes";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

interface RuntimeRow {
  decisionId: string;
  createdAt: string;
  outcome: string;
  reasonCodes: string[];
  contractId: string | null;
  contractVersion: number | null;
  capabilityId: string | null;
  tool: string;
  operation: string;
  resource: string | null;
  taskId: string;
  agentId: string;
  agentName: string;
}

/**
 * Live view over runtime authorization decisions.
 *
 * Everything here is read directly from `authorization_decisions` and
 * `tool_requests` via RLS-scoped SELECTs — the same evidence
 * `authorize_tool_call()` itself wrote, not a simulation. Nothing on this
 * page ever executed a tool: Part 4 evaluates and records decisions, it
 * does not call external services, and every status pill below reflects
 * that boundary.
 */
export default async function RuntimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant("/app/runtime");

  const [agents, decisionsResult] = await Promise.all([
    repositories.agents.listByTenant(identity.tenant.tenantId),
    context.supabase
      .from("authorization_decisions")
      .select(
        "id, outcome, reason_codes, contract_id, contract_version, capability_id, tool_request_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const decisionRows = decisionsResult.data ?? [];
  if (decisionsResult.error) {
    console.error("runtime dashboard: could not load decisions", decisionsResult.error.message);
  }

  const toolRequestIds = decisionRows.map((d) => d.tool_request_id);
  const { data: toolRequestRows } = toolRequestIds.length
    ? await context.supabase
        .from("tool_requests")
        .select("id, tool, operation, resource, task_id, agent_id")
        .in("id", toolRequestIds)
    : { data: [] };

  const toolRequestById = new Map((toolRequestRows ?? []).map((r) => [r.id, r]));
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

  const rows: RuntimeRow[] = decisionRows
    .map((decision): RuntimeRow | null => {
      const request = toolRequestById.get(decision.tool_request_id);
      if (!request) return null;
      const reasonCodes = Array.isArray((decision.reason_codes as { items?: unknown })?.items)
        ? (decision.reason_codes as { items: { code: string }[] }).items.map((item) => item.code)
        : [];
      return {
        decisionId: decision.id,
        createdAt: decision.created_at,
        outcome: decision.outcome,
        reasonCodes,
        contractId: decision.contract_id,
        contractVersion: decision.contract_version,
        capabilityId: decision.capability_id,
        tool: request.tool,
        operation: request.operation,
        resource: request.resource,
        taskId: request.task_id,
        agentId: request.agent_id,
        agentName: agentNameById.get(request.agent_id) ?? "unknown",
      };
    })
    .filter((row): row is RuntimeRow => row !== null)
    .filter((row) => !params.agentId || row.agentId === params.agentId)
    .filter((row) => !params.taskId || row.taskId === params.taskId)
    .filter((row) => !params.tool || row.tool === params.tool)
    .filter((row) => !params.outcome || row.outcome === params.outcome);

  const outcomes = Array.from(new Set(decisionRows.map((d) => d.outcome))).sort();
  const tools = Array.from(new Set(rows.map((r) => r.tool))).sort();

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Runtime authorization
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Live decisions from <code>POST /api/v1/authorize</code>. Part 4 evaluates and records these requests
          deterministically — it never calls an external tool, so nothing below reflects real execution.
        </p>
      </header>

      <form className="flex flex-wrap items-center gap-2" method="get">
        <select
          name="agentId"
          defaultValue={params.agentId ?? ""}
          className="rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm text-on-surface"
        >
          <option value="">All agents</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <select
          name="tool"
          defaultValue={params.tool ?? ""}
          className="rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm text-on-surface"
        >
          <option value="">All tools</option>
          {tools.map((tool) => (
            <option key={tool} value={tool}>
              {tool}
            </option>
          ))}
        </select>
        <select
          name="outcome"
          defaultValue={params.outcome ?? ""}
          className="rounded border border-outline-variant/40 bg-surface-container px-2 py-1 font-body-sm text-body-sm text-on-surface"
        >
          <option value="">All outcomes</option>
          {outcomes.map((outcome) => (
            <option key={outcome} value={outcome}>
              {outcome}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded border border-outline-variant/40 bg-surface-container-high px-3 py-1 font-label-sm text-label-sm text-on-surface"
        >
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="font-body-sm text-body-sm text-outline">No runtime authorization requests yet.</p>
      ) : (
        <div className="overflow-auto rounded-xl border border-outline-variant/30 bg-surface-container">
          <table className="w-full min-w-[960px] border-collapse text-left">
            <caption className="sr-only">Recent runtime authorization decisions</caption>
            <thead>
              <tr className="border-b border-outline-variant/30">
                {["Time", "Agent", "Tool", "Status", "Reason", "Budget", "Contract"].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="whitespace-nowrap px-space-lg py-space-md font-label-caps text-label-caps uppercase tracking-widest text-outline"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const presentation = presentDecisionStatus(row.outcome as DecisionStatus);
                return (
                  <tr key={row.decisionId} className="border-b border-outline-variant/20 last:border-b-0">
                    <td className="whitespace-nowrap px-space-lg py-space-md font-mono-code text-[11px] text-outline">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-space-lg py-space-md font-body-sm text-body-sm text-on-surface-variant">
                      {row.agentName}
                    </td>
                    <td className="px-space-lg py-space-md font-mono-code text-[12px] text-on-surface">
                      {row.tool}
                      {row.resource && <span className="ml-1 text-outline">· {row.resource}</span>}
                    </td>
                    <td className="px-space-lg py-space-md">
                      <span className="inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px]">
                        {presentation.label}
                      </span>
                    </td>
                    <td className="px-space-lg py-space-md font-body-sm text-body-sm text-on-surface-variant">
                      {summarizeReasonCodes(row.reasonCodes)}
                    </td>
                    <td className="whitespace-nowrap px-space-lg py-space-md font-mono-code text-[11px] text-outline">
                      {row.capabilityId ? "reserved" : "—"}
                    </td>
                    <td className="whitespace-nowrap px-space-lg py-space-md font-mono-code text-[11px] text-outline">
                      {row.contractId ? `v${row.contractVersion}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
