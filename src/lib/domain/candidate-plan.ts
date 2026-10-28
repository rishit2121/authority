import { z } from "zod";

import { idSchema, toolArgumentsSchema, toolNameSchema } from "./common";

/**
 * The untrusted candidate execution plan — what a user structures (no LLM
 * required) before Authority's server-only pipeline validates and compiles
 * it. Submitting this grants no authority of any kind; it is exactly the
 * "untrusted candidate execution plan" half of the trust boundary.
 *
 * Deliberately not the same type as `Plan`/`PlanNode` (see plan.ts): those
 * represent a plan's *persisted, already-versioned* record, addressed by a
 * database-generated `id`. This schema is the *input* shape a caller
 * constructs, addressed by caller-assigned stable string keys so that
 * `dependencies`/`dataFlowRefs` can reference sibling nodes before any of
 * them have a database identity yet.
 *
 * Duplicates `sideEffectSchema`'s values from `lib/registry/types.ts` rather
 * than importing them: the registry module is `server-only`, and this schema
 * must stay importable from anywhere a form needs to validate input,
 * including client-side. The values are kept manually in sync; a mismatch
 * would surface immediately as every plan failing validation against the
 * registry, not as a silent gap.
 */
export const candidateSideEffectSchema = z.enum([
  "read",
  "write_create",
  "write_update",
  "write_delete",
  "admin",
]);
export type CandidateSideEffect = z.infer<typeof candidateSideEffectSchema>;

/** A caller-assigned stable identifier for one node, unique within its plan. Not a database id. */
export const candidateNodeIdSchema = z.string().min(1).max(100);

export const dataFlowRefSchema = z
  .object({
    /** Which of this node's fields the reference binds — an argument key, or the literal "resource" for the resource binding itself. */
    argumentKey: z.string().min(1).max(100),
    fromNodeId: candidateNodeIdSchema,
    output: z.string().min(1).max(100),
  })
  .strict();
export type DataFlowRef = z.infer<typeof dataFlowRefSchema>;

export const candidatePlanNodeSchema = z
  .object({
    id: candidateNodeIdSchema,
    /** Submission order. Also the topological order the database independently re-verifies dependencies/data-flow refs against. */
    sequence: z.number().int().nonnegative(),
    tool: toolNameSchema,
    /** Concrete argument values only — a templated/data-flow-bound value is declared via `dataFlowRefs`, never smuggled into a literal string here. */
    arguments: toolArgumentsSchema,
    /** Concrete resource identifier, when known at authoring time rather than bound via `dataFlowRefs`. */
    resourceBinding: z.string().min(1).max(500).optional(),
    /** Other nodes (by `id`) that must be considered earlier — validated for acyclicity via the `sequence` ordering. */
    dependencies: z.array(candidateNodeIdSchema).max(20).default([]),
    /** Named outputs this node claims to produce, referenceable by later nodes' `dataFlowRefs`. */
    declaredOutputs: z.array(z.string().min(1).max(100)).max(10).default([]),
    dataFlowRefs: z.array(dataFlowRefSchema).max(20).default([]),
    /**
     * Free-text argument keys the agent writes at run time (a message body, subject or title). Each must be a
     * registry `freeText` field that this node neither pins nor takes from an earlier step. This is how a required
     * free-text field is left to the agent; recipients, channels, ids and amounts are never agent-generated.
     */
    agentGenerated: z
      .array(z.string().min(1).max(100))
      .max(20)
      .refine((keys) => new Set(keys).size === keys.length, { message: "agentGenerated keys must be unique" })
      .optional(),
    expectedSideEffect: candidateSideEffectSchema,
    maxInvocations: z.number().int().positive().max(20).default(1),
  })
  .strict();
export type CandidatePlanNode = z.infer<typeof candidatePlanNodeSchema>;

export const MAX_CANDIDATE_PLAN_NODES = 50;

export const candidatePlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: idSchema,
    nodes: z.array(candidatePlanNodeSchema).min(1).max(MAX_CANDIDATE_PLAN_NODES),
  })
  .strict();
export type CandidatePlan = z.infer<typeof candidatePlanSchema>;

/**
 * An empty `agentGenerated` list means the same as none. Dropping it right after parsing makes a plan hash
 * identically however it was submitted and however it is reloaded from storage (the dashboard re-verifies by hash).
 * Kept out of the schema itself: the AI planners derive a JSON Schema from it, which cannot express a transform.
 */
export function normalizeCandidatePlan(plan: CandidatePlan): CandidatePlan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.agentGenerated && node.agentGenerated.length > 0) return node;
      const { agentGenerated: _empty, ...rest } = node;
      void _empty;
      return rest;
    }),
  };
}
