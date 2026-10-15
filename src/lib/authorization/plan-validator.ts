import type { CandidatePlan, CandidatePlanNode, Policy } from "@/lib/domain";
import type { ArgumentField, LoadedRegistry } from "@/lib/registry";

import { evaluatePolicyCondition, isSupportedPolicyKey } from "./policy-conditions";

/**
 * Deterministic candidate-plan validation.
 *
 * Two distinct failure modes, deliberately not conflated:
 *
 *  - Structural malformation (duplicate node IDs, duplicate sequence
 *    numbers, a dependency/data-flow reference to a node that doesn't
 *    exist or isn't strictly earlier, a data-flow reference to an output
 *    the source node never declared) throws `PlanStructureError` — the
 *    whole submission is rejected outright, the same way `create_candidate_plan`
 *    independently re-verifies these exact properties at the database layer
 *    (see supabase/migrations/*_candidate_plan_columns.sql). This function
 *    computing them in TypeScript first is a better error message ahead of
 *    that backstop, never a replacement for it.
 *  - Per-node semantic/policy findings never throw — every node gets exactly
 *    one `PlanNodeFinding`, chosen as the *most severe* applicable outcome
 *    (denied > replan > clarify > requires_review > accepted), because a
 *    node can trigger more than one rule and silently reporting only the
 *    first one found would hide a more serious problem.
 *
 * This function does not claim structural validity proves the plan matches
 * the user's prose — it cannot. A node that passes every check here is
 * "accepted" only in the narrow sense of "mechanically well-formed and not
 * policy-forbidden," never "verified to match the user's intent."
 */

export class PlanStructureError extends Error {}

export type PlanNodeFindingStatus = "accepted" | "requires_review" | "clarify" | "replan" | "denied";

const SEVERITY: Record<PlanNodeFindingStatus, number> = {
  denied: 4,
  replan: 3,
  clarify: 2,
  requires_review: 1,
  accepted: 0,
};

export interface PlanNodeFinding {
  nodeId: string;
  status: PlanNodeFindingStatus;
  reasons: string[];
}

export interface PlanValidationResult {
  findings: PlanNodeFinding[];
  /** Node IDs with status "accepted", in ascending sequence order. */
  acceptedNodeIds: string[];
  /**
   * Node IDs with status "accepted" or "requires_review", in ascending
   * sequence order — exactly what may reach the solver and compiler.
   *
   * A `requires_review` node (unconditionally, today, only external
   * communication) is mechanically well-formed and not policy-forbidden; it
   * is not the same failure class as `denied` (forbidden outright, never
   * reconsidered), `clarify` (missing information, not yet a real request)
   * or `replan` (malformed, cannot be evaluated as written). Part 3B's
   * approval workflow is exactly what "review" is deferred to: the finding
   * is preserved and surfaced (see `findings`, and
   * `deriveRequiredApprovals()` in `approval-rules.ts`, which turns every
   * `requires_review` node into a mandatory approval gate on activation),
   * never silently dropped and never silently overridden into "accepted".
   * A `denied` operation still can never appear here under any
   * circumstance — only the two statuses named above ever do.
   */
  includedNodeIds: string[];
  /** Distinct operation IDs required by included nodes, deterministically sorted. */
  requiredOperations: string[];
}

export interface PlanValidatorOptions {
  registry: LoadedRegistry;
  /** Only the tenant's currently-active policies — the caller resolves that, this function does not query anything. */
  activePolicies: readonly Policy[];
}

function assertStructurallyValid(plan: CandidatePlan): void {
  const seenIds = new Set<string>();
  const seenSequences = new Set<number>();
  const bySequence = new Map<string, number>();

  for (const node of plan.nodes) {
    if (seenIds.has(node.id)) {
      throw new PlanStructureError(`duplicate node id: ${node.id}`);
    }
    seenIds.add(node.id);

    if (seenSequences.has(node.sequence)) {
      throw new PlanStructureError(
        `duplicate sequence number ${node.sequence} (sequence must define a total order)`,
      );
    }
    seenSequences.add(node.sequence);
    bySequence.set(node.id, node.sequence);
  }

  const nodesById = new Map(plan.nodes.map((n) => [n.id, n] as const));

  for (const node of plan.nodes) {
    for (const depId of node.dependencies) {
      const dep = nodesById.get(depId);
      if (!dep) {
        throw new PlanStructureError(`node ${node.id} depends on unknown node ${depId}`);
      }
      if (dep.sequence >= node.sequence) {
        throw new PlanStructureError(
          `node ${node.id} (sequence ${node.sequence}) depends on ${depId} (sequence ${dep.sequence}), which is not strictly earlier — dependencies must reference an earlier point in the submitted topological order`,
        );
      }
    }

    for (const ref of node.dataFlowRefs) {
      const source = nodesById.get(ref.fromNodeId);
      if (!source) {
        throw new PlanStructureError(
          `node ${node.id} has a data-flow reference to unknown node ${ref.fromNodeId}`,
        );
      }
      if (source.sequence >= node.sequence) {
        throw new PlanStructureError(
          `node ${node.id} (sequence ${node.sequence}) has a data-flow reference to ${ref.fromNodeId} (sequence ${source.sequence}), which is not strictly earlier`,
        );
      }
      if (!source.declaredOutputs.includes(ref.output)) {
        throw new PlanStructureError(
          `node ${node.id}'s data-flow reference names output "${ref.output}" on ${ref.fromNodeId}, which that node never declared`,
        );
      }
    }
  }
}

function argumentTypeMatches(field: ArgumentField, value: unknown): boolean {
  switch (field.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "stringArray":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
  }
}

function evaluateNode(node: CandidatePlanNode, options: PlanValidatorOptions): PlanNodeFinding {
  const outcomes: { status: PlanNodeFindingStatus; reasons: string[] }[] = [];
  const push = (status: PlanNodeFindingStatus, reason: string) =>
    outcomes.push({ status, reasons: [reason] });

  const operation = options.registry.operations.get(node.tool);
  if (!operation) {
    push("denied", `"${node.tool}" is not in the trusted registry`);
    return pickMostSevere(node.id, outcomes);
  }

  const boundArgumentKeys = new Set(Object.keys(node.arguments));
  const dataFlowArgumentKeys = new Set(node.dataFlowRefs.map((r) => r.argumentKey));
  const knownFieldKeys = new Set(operation.argumentFields.map((f) => f.key));

  for (const key of boundArgumentKeys) {
    if (!knownFieldKeys.has(key)) {
      push("replan", `argument "${key}" is not recognized for ${node.tool}`);
    }
  }

  for (const field of operation.argumentFields) {
    const hasConcrete = Object.hasOwn(node.arguments, field.key);
    const hasDataFlow = dataFlowArgumentKeys.has(field.key);

    if (hasConcrete && !argumentTypeMatches(field, node.arguments[field.key])) {
      push("replan", `argument "${field.key}" must be of type ${field.type} for ${node.tool}`);
      continue;
    }

    if (hasConcrete || hasDataFlow) continue;

    // Neither a concrete value nor a data-flow binding is present. A
    // resource-identifying field must always be bound regardless of its own
    // `required` flag — "resource bindings are concrete or derived from
    // trusted inputs/prior verified outputs" is unconditional — while a
    // merely-`required` non-resource field is the ordinary underspecified
    // case.
    if (field.identifiesResource) {
      push("clarify", `resource-identifying argument "${field.key}" is not bound for ${node.tool}`);
    } else if (field.required) {
      push("clarify", `missing required argument "${field.key}" for ${node.tool}`);
    }
  }

  if (node.expectedSideEffect !== operation.sideEffect) {
    push(
      "denied",
      `declared side effect "${node.expectedSideEffect}" does not match the registry's "${operation.sideEffect}" for ${node.tool}`,
    );
  }

  if (operation.externalCommunication) {
    // Unconditional: Part 3A has no deterministic way to confirm a human
    // intended this specific external disclosure, so it always escalates —
    // never silently accepted, never automatically denied outright.
    push(
      "requires_review",
      `${node.tool} communicates outside the organization and always requires human review`,
    );
  }

  const denyOutcome = evaluateActivePolicies(node, operation.resourceType, options.activePolicies);
  if (denyOutcome) outcomes.push(denyOutcome);

  if (outcomes.length === 0) {
    return { nodeId: node.id, status: "accepted", reasons: [] };
  }

  return pickMostSevere(node.id, outcomes);
}

/** Exported for approval-rules.ts, which turns an unevaluable deny policy into an approval requirement. */
export function evaluateActivePolicies(
  node: CandidatePlanNode,
  resourceType: string,
  policies: readonly Policy[],
): { status: PlanNodeFindingStatus; reasons: string[] } | null {
  for (const policy of policies) {
    if (policy.effect !== "deny") continue; // allow-effect policies grant nothing in Part 3A; default-deny already governs.

    let allSupported = true;
    let allMatch = true;

    for (const condition of policy.conditions) {
      if (!isSupportedPolicyKey(condition.key)) {
        allSupported = false;
        continue;
      }
      const candidateValue =
        condition.key === "tool" ? node.tool : condition.key === "resource" ? resourceType : "";
      // "provider" is derived from the tool's dotted prefix — never client-supplied.
      const resolved = condition.key === "provider" ? node.tool.split(".")[0] : candidateValue;
      const result = evaluatePolicyCondition(condition.matches, resolved);
      if (result === null) {
        allSupported = false;
      } else if (!result) {
        allMatch = false;
      }
    }

    if (!allSupported) {
      return {
        status: "requires_review",
        reasons: [`policy "${policy.name}" could not be fully evaluated and might forbid this operation`],
      };
    }
    if (allMatch && policy.conditions.length > 0) {
      return { status: "denied", reasons: [`forbidden by policy "${policy.name}"`] };
    }
  }
  return null;
}

function pickMostSevere(
  nodeId: string,
  outcomes: { status: PlanNodeFindingStatus; reasons: string[] }[],
): PlanNodeFinding {
  let best = outcomes[0];
  for (const outcome of outcomes) {
    if (SEVERITY[outcome.status] > SEVERITY[best.status]) best = outcome;
  }
  const reasons = outcomes.filter((o) => o.status === best.status).flatMap((o) => o.reasons);
  return { nodeId, status: best.status, reasons };
}

export function validateCandidatePlan(
  plan: CandidatePlan,
  options: PlanValidatorOptions,
): PlanValidationResult {
  assertStructurallyValid(plan);

  const ordered = [...plan.nodes].sort((a, b) => a.sequence - b.sequence);
  const findings = ordered.map((node) => evaluateNode(node, options));

  const acceptedNodeIds = findings.filter((f) => f.status === "accepted").map((f) => f.nodeId);
  const includedNodeIds = findings
    .filter((f) => f.status === "accepted" || f.status === "requires_review")
    .map((f) => f.nodeId);
  const includedNodes = ordered.filter((n) => includedNodeIds.includes(n.id));
  const requiredOperations = [...new Set(includedNodes.map((n) => n.tool))].sort();

  return { findings, acceptedNodeIds, includedNodeIds, requiredOperations };
}
