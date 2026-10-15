import type {
  AllowedAction,
  CandidatePlan,
  CandidatePlanNode,
  DataFlowRef,
  EphemeralLimits,
} from "@/lib/domain";
import type { LoadedRegistry } from "@/lib/registry";

import { canonicalHash } from "./canonicalize";
import type { PlanValidationResult } from "./plan-validator";
import type { SolverOutcome } from "./solver";

/**
 * Compiles a validated candidate plan and a solved permission set into a
 * proposed Task Authority Contract's content.
 *
 * The critical narrowing this module exists to perform: a selected
 * *permission* may technically expose more than this task needs (that's
 * `solverOutcome.solution.excessOperations`, reported for the UI, never
 * silently dropped). The compiled *contract* narrows runtime use down to
 * exactly the accepted plan's operations, resources and arguments,
 * regardless of what the underlying permission allows — "a broad underlying
 * permission must not mean every operation or resource it technically
 * exposes is allowed through Authority's runtime contract."
 *
 * This module never claims the resulting contract is trustworthy merely
 * because it ran here — see contract-verifier.ts, which independently
 * re-derives everything rather than trusting this output, and
 * persistence/rpc.ts's `propose_task_contract`, which persists it as
 * `proposed` only, granting no runtime authority regardless.
 *
 * Part 3B: "the accepted plan" above now means every node whose finding is
 * "accepted" *or* "requires_review" (see `PlanValidationResult.includedNodeIds`).
 * A `requires_review` node's operation is real content in the compiled
 * contract, not a silently-widened permission — the contract still narrows
 * to exactly it — but activation of a contract containing one is gated on a
 * human approval by `approval-rules.ts`'s deriver. `denied` nodes are
 * excluded exactly as before, unconditionally, with no path to reconsideration.
 */

export const COMPILER_VERSION = "authority-compiler-2026-09-30-8";
export const DEFAULT_CONTRACT_EXPIRY_SECONDS = 3600;
export const SPEC_VERSION = "v1";

export interface CompiledContract {
  specVersion: string;
  allowedActions: AllowedAction[];
  forbiddenResources: string[];
  /** Exact tool identifiers denied outright by an active policy among the candidate plan's nodes. */
  forbiddenOperations: string[];
  ephemeralLimits: EphemeralLimits;
  dataFlowBindings: DataFlowRef[];
  /** Tool identifiers that require human approval before their capability may ever be issued. */
  requiredApprovals: string[];
  /** Tool identifiers included only because their plan node's finding was "requires_review". */
  reviewRequiredOperations: string[];
  registryVersion: string;
  compilerVersion: string;
  selectedPermissionIds: string[];
  excessOperations: string[];
  inputHash: string;
  outputHash: string;
}

export interface CompileContractInput {
  candidatePlan: CandidatePlan;
  validation: PlanValidationResult;
  solverOutcome: Extract<SolverOutcome, { status: "solved" }>;
  registry: LoadedRegistry;
}

export class CompilationError extends Error {}

/**
 * Nodes eligible for compilation: "accepted" or "requires_review" (see
 * `PlanValidationResult.includedNodeIds`'s doc for why the latter belongs
 * here) — never "denied", "clarify" or "replan".
 */
function includedNodes(plan: CandidatePlan, validation: PlanValidationResult): CandidatePlanNode[] {
  const includedIds = new Set(validation.includedNodeIds);
  return plan.nodes.filter((n) => includedIds.has(n.id)).sort((a, b) => a.sequence - b.sequence);
}

/**
 * One allowed action per distinct (tool, pinned arguments) pair. Two plan
 * steps that call the same tool with the same pinned values merge into one
 * action whose budget is their sum; steps with different values -- "email
 * Alice" and "email Bob" -- stay separate actions, each with its own budget.
 * (Merging them by tool alone once let the later step's values overwrite the
 * earlier step's while the budgets added up: Alice's email was refused and a
 * second email to Bob was allowed.) For a plan that uses each tool once, the
 * output is identical to the per-tool form, so existing contracts' hashes are
 * unchanged.
 */
function buildAllowedActions(nodes: readonly CandidatePlanNode[]): AllowedAction[] {
  const byAction = new Map<
    string,
    { tool: string; maxInvocations: number; constraints: Array<[string, string]> }
  >();

  for (const node of nodes) {
    const constraintKeys = new Map<string, string>();
    for (const [key, value] of Object.entries(node.arguments)) {
      // Only concrete, single string values become an `equals` constraint —
      // never widened beyond exactly what this node declared. A data-flow
      // bound argument is never turned into a constraint here at all; it is
      // recorded in `dataFlowBindings` instead, since its concrete value
      // does not exist until runtime.
      // Numbers and booleans are pinned too, as their canonical text (the runtime compares argument text). Before
      // this, a plan step that fixed `amount_cents: 4900` left the amount unconstrained at runtime, so a refund could
      // be escalated to any amount (found by the Part 8 refund-escalation scenario).
      if (typeof value === "string") constraintKeys.set(key, value);
      else if (typeof value === "number" || typeof value === "boolean")
        constraintKeys.set(key, String(value));
    }
    const constraints = [...constraintKeys.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const actionKey = JSON.stringify([node.tool, constraints]);
    const entry = byAction.get(actionKey) ?? { tool: node.tool, maxInvocations: 0, constraints };
    entry.maxInvocations += node.maxInvocations;
    byAction.set(actionKey, entry);
  }

  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...byAction.values()]
    .sort((a, b) => cmp(a.tool, b.tool) || cmp(JSON.stringify(a.constraints), JSON.stringify(b.constraints)))
    .map((entry) => ({
      tool: entry.tool,
      constraints: entry.constraints.map(([key, value]) => ({ key, equals: value })),
      maxInvocations: entry.maxInvocations,
    }));
}

function normalizedInput(
  plan: CandidatePlan,
  included: readonly CandidatePlanNode[],
  registryVersion: string,
) {
  return {
    schemaVersion: plan.schemaVersion,
    taskId: plan.taskId,
    registryVersion,
    includedNodes: included.map((n) => ({
      id: n.id,
      sequence: n.sequence,
      tool: n.tool,
      arguments: n.arguments,
      dependencies: [...n.dependencies].sort(),
      declaredOutputs: [...n.declaredOutputs].sort(),
      dataFlowRefs: n.dataFlowRefs,
      expectedSideEffect: n.expectedSideEffect,
      maxInvocations: n.maxInvocations,
    })),
  };
}

/**
 * Exported so contract-verifier.ts recomputes the output hash from this
 * exact function rather than a hand-maintained copy of its field list — a
 * duplicated copy silently drifted out of sync with a new `CompiledContract`
 * field once already (`reviewRequiredOperations`), which a test caught
 * immediately but which a second field addition could just as easily repeat.
 */
export function normalizedOutput(contract: Omit<CompiledContract, "inputHash" | "outputHash">) {
  return {
    specVersion: contract.specVersion,
    allowedActions: contract.allowedActions,
    forbiddenResources: [...contract.forbiddenResources].sort(),
    forbiddenOperations: [...contract.forbiddenOperations].sort(),
    ephemeralLimits: contract.ephemeralLimits,
    dataFlowBindings: contract.dataFlowBindings,
    requiredApprovals: [...contract.requiredApprovals].sort(),
    reviewRequiredOperations: [...contract.reviewRequiredOperations].sort(),
    registryVersion: contract.registryVersion,
    compilerVersion: contract.compilerVersion,
    selectedPermissionIds: contract.selectedPermissionIds,
    excessOperations: contract.excessOperations,
  };
}

export function compileContract(input: CompileContractInput): CompiledContract {
  const { candidatePlan, validation, solverOutcome, registry } = input;

  const included = includedNodes(candidatePlan, validation);
  if (included.length === 0) {
    throw new CompilationError("no accepted or review-pending plan nodes to compile a contract from");
  }

  const deniedTools = [
    ...new Set(validation.findings.filter((f) => f.status === "denied").map((f) => f.nodeId)),
  ]
    .map((nodeId) => candidatePlan.nodes.find((n) => n.id === nodeId)?.tool)
    .filter((t): t is string => Boolean(t));

  const requiredApprovals = [
    ...new Set(included.filter((n) => registry.operations.get(n.tool)?.requiresApproval).map((n) => n.tool)),
  ].sort();

  // Distinct from `requiredApprovals` above (a registry-level "this
  // operation always needs approval" flag): this is which included
  // operations reached the contract only because the plan validator's
  // finding for their node was "requires_review", not "accepted" — see
  // `PlanValidationResult.includedNodeIds`'s doc. `deriveRequiredApprovals()`
  // in `approval-rules.ts` is what actually turns this into an activation
  // gate; recorded here purely as compiled-contract content, byte-hashed
  // like everything else.
  const reviewRequiredOperations = [
    ...new Set(
      validation.findings
        .filter((f) => f.status === "requires_review")
        .map((f) => candidatePlan.nodes.find((n) => n.id === f.nodeId)?.tool)
        .filter((t): t is string => Boolean(t)),
    ),
  ].sort();

  const dataFlowBindings = included.flatMap((n) => n.dataFlowRefs);

  const totalInvocations = included.reduce((sum, n) => sum + n.maxInvocations, 0);

  const withoutHashes: Omit<CompiledContract, "inputHash" | "outputHash"> = {
    specVersion: SPEC_VERSION,
    allowedActions: buildAllowedActions(included),
    forbiddenResources: [],
    forbiddenOperations: [...new Set(deniedTools)].sort(),
    ephemeralLimits: {
      maxToolInvocations: totalInvocations,
      expiresInSeconds: DEFAULT_CONTRACT_EXPIRY_SECONDS,
    },
    dataFlowBindings,
    requiredApprovals,
    reviewRequiredOperations,
    registryVersion: registry.registryVersion,
    compilerVersion: COMPILER_VERSION,
    selectedPermissionIds: solverOutcome.solution.selectedPermissionIds,
    excessOperations: solverOutcome.solution.excessOperations,
  };

  const inputHash = canonicalHash(normalizedInput(candidatePlan, included, registry.registryVersion));
  const outputHash = canonicalHash(normalizedOutput(withoutHashes));

  return { ...withoutHashes, inputHash, outputHash };
}
