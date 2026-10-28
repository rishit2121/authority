import { candidatePlanSchema, normalizeCandidatePlan, type CandidatePlan } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { Tables } from "../db-types";
import { readVersionedJson } from "../versioned-json";

/**
 * Rebuilds the exact `CandidatePlan` a caller originally submitted, from
 * its persisted `plan_nodes` rows.
 *
 * This is a different reconstruction from `planRowsToDomain()`
 * (mappers/plan.ts), which produces the domain's `Plan`/`PlanNode` — the
 * persisted-record shape used for display, addressed by database id. This
 * function exists only for activation's pre-check (see the activation
 * server action), which must re-run the deterministic pipeline
 * (validate -> solve -> compile -> verify) against the *original* candidate
 * plan shape and compare hashes — that pipeline consumes `CandidatePlan`,
 * addressed by the caller's own stable string node keys, not `Plan`.
 *
 * Every field reconstructed here has a corresponding persisted column
 * (see `20260925000002_candidate_plan_columns.sql` and
 * `20260926000003_persist_expected_effect.sql`); nothing is inferred or
 * defaulted beyond what candidatePlanSchema's own `.default()`s already do
 * for a genuinely-empty array.
 */
export function reconstructCandidatePlan(
  taskId: string,
  nodeRows: readonly Tables<"plan_nodes">[],
): CandidatePlan {
  const nodes = [...nodeRows]
    .sort((a, b) => a.sequence_no - b.sequence_no)
    .map((row) => {
      const argumentsPayload = readVersionedJson(
        row.normalized_arguments,
        [1],
        "plan_nodes.normalized_arguments",
      );
      const declaredOutputsPayload = row.declared_outputs
        ? readVersionedJson(row.declared_outputs, [1], "plan_nodes.declared_outputs")
        : undefined;
      const dataFlowRefsPayload = row.data_flow_refs
        ? readVersionedJson(row.data_flow_refs, [1], "plan_nodes.data_flow_refs")
        : undefined;

      return {
        id: row.node_key,
        sequence: row.sequence_no,
        tool: row.tool,
        arguments: argumentsPayload.values,
        resourceBinding: row.resource ?? undefined,
        dependencies: row.dependencies ?? [],
        declaredOutputs: declaredOutputsPayload?.outputs ?? [],
        dataFlowRefs: dataFlowRefsPayload?.refs ?? [],
        agentGenerated:
          row.agent_generated && row.agent_generated.length > 0 ? row.agent_generated : undefined,
        expectedSideEffect: row.expected_effect ?? undefined,
        maxInvocations: row.max_invocations ?? undefined,
      };
    });

  const result = candidatePlanSchema.safeParse({ schemaVersion: 1, taskId, nodes });
  if (!result.success) {
    throwInvalidRow("reconstructed_candidate_plan", taskId, result.error);
  }
  return normalizeCandidatePlan(result.data);
}
