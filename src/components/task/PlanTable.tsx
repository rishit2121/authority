import { DecisionStatusBadge } from "@/components/ui/DecisionStatusBadge";
import type { AuthorizationDecision, Plan, ToolRequest } from "@/lib/domain";

import { Panel } from "./panels";

/**
 * What the agent proposed, paired with what Authority decided about each step.
 * The rejected secret read is called out rather than buried in the list.
 */
export function PlanTable({
  plan,
  decisions,
  toolRequests,
}: {
  plan: Plan;
  decisions: AuthorizationDecision[];
  toolRequests: ToolRequest[];
}) {
  const decisionForNode = (nodeId: string) => {
    const request = toolRequests.find((r) => r.planNodeId === nodeId);
    return request ? decisions.find((d) => d.toolRequestId === request.id) : undefined;
  };

  return (
    <Panel
      id="plan"
      title="Proposed execution plan"
      subtitle={`${plan.nodes.length} steps submitted by the agent — untrusted until each was evaluated`}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <caption className="sr-only">Agent plan nodes and the authorization decision for each</caption>
          <thead>
            <tr className="border-b border-outline-variant/30">
              {["#", "Tool call", "Arguments", "Decision"].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-space-md py-space-sm font-label-caps text-label-caps uppercase tracking-widest text-outline"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.nodes.map((node) => {
              const decision = decisionForNode(node.id);
              const rejected = node.status === "rejected";

              return (
                <tr
                  key={node.id}
                  className={`border-b border-outline-variant/20 last:border-b-0 ${
                    rejected ? "bg-deny/5" : ""
                  }`}
                >
                  <td className="px-space-md py-space-md font-mono-code text-[12px] text-outline">
                    {node.sequence + 1}
                  </td>
                  <td className="px-space-md py-space-md">
                    <span
                      className={`font-mono-code text-[12px] ${rejected ? "text-deny" : "text-on-surface"}`}
                    >
                      {node.tool}
                    </span>
                    {node.rationale ? (
                      <p className="mt-1 max-w-sm font-body-sm text-body-sm text-on-surface-variant">
                        {node.rationale}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-space-md py-space-md font-mono-code text-[11px] text-on-surface-variant">
                    {Object.entries(node.arguments).map(([key, value]) => (
                      <span key={key} className="block">
                        {key}: {Array.isArray(value) ? value.join(", ") : String(value)}
                      </span>
                    ))}
                  </td>
                  <td className="px-space-md py-space-md">
                    {decision ? <DecisionStatusBadge status={decision.status} /> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
