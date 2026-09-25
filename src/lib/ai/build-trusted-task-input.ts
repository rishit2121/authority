import "server-only";

import type { Policy } from "@/lib/domain";
import type { LoadedRegistry } from "@/lib/registry";

import type { TrustedTaskInput, TrustedToolDescriptor } from "./plan-proposal-provider";

function describePolicy(policy: Policy): string {
  const conditions = policy.conditions.map((c) => `${c.key} matches "${c.matches}"`).join(" and ");
  const scope = conditions.length > 0 ? ` when ${conditions}` : "";
  if (policy.effect === "require_approval") {
    return `require_approval${scope} (minimum role: ${policy.requiredApprovalRole ?? "unspecified"})`;
  }
  return `${policy.effect}${scope}`;
}

/**
 * Builds the exact, minimal `TrustedTaskInput` a plan-proposal provider is
 * given — the registry's own operation descriptors and short policy
 * summaries, nothing else. See `plan-proposal-provider.ts`'s module doc for
 * what this deliberately excludes (secrets, credentials, other tenants'
 * data, raw database rows).
 */
export function buildTrustedTaskInput(input: {
  taskId: string;
  taskIntent: string;
  registry: LoadedRegistry;
  activePolicies: readonly Policy[];
  resourceReferences: readonly string[];
}): TrustedTaskInput {
  const availableTools: TrustedToolDescriptor[] = [...input.registry.operations.values()]
    .map((op) => ({
      id: op.id,
      provider: op.provider,
      sideEffect: op.sideEffect,
      resourceType: op.resourceType,
      dataSensitivity: op.dataSensitivity,
      externalCommunication: op.externalCommunication,
      financialImpact: op.financialImpact,
      argumentFields: op.argumentFields.map((f) => ({
        key: f.key,
        type: f.type,
        required: f.required,
        identifiesResource: f.identifiesResource,
      })),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const policySummaries = input.activePolicies
    .filter((p) => p.effect === "deny" || p.effect === "require_approval")
    .map(describePolicy)
    .sort();

  return {
    taskId: input.taskId,
    taskIntent: input.taskIntent,
    availableTools,
    policySummaries,
    resourceReferences: [...input.resourceReferences],
  };
}
