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
 */

export const COMPILER_VERSION = "authority-compiler-2026-09-25";
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

function acceptedNodes(plan: CandidatePlan, validation: PlanValidationResult): CandidatePlanNode[] {
  const acceptedIds = new Set(validation.acceptedNodeIds);
  return plan.nodes.filter((n) => acceptedIds.has(n.id)).sort((a, b) => a.sequence - b.sequence);
}

function buildAllowedActions(nodes: readonly CandidatePlanNode[]): AllowedAction[] {
  const byTool = new Map<string, { maxInvocations: number; constraintKeys: Map<string, string> }>();

  for (const node of nodes) {
    const entry = byTool.get(node.tool) ?? { maxInvocations: 0, constraintKeys: new Map<string, string>() };
    entry.maxInvocations += node.maxInvocations;
    for (const [key, value] of Object.entries(node.arguments)) {
      // Only concrete, single string values become an `equals` constraint —
      // never widened beyond exactly what this node declared. A data-flow
      // bound argument is never turned into a constraint here at all; it is
      // recorded in `dataFlowBindings` instead, since its concrete value
      // does not exist until runtime.
      if (typeof value === "string") entry.constraintKeys.set(key, value);
    }
    byTool.set(node.tool, entry);
  }

  return [...byTool.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([tool, entry]) => ({
      tool,
      constraints: [...entry.constraintKeys.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => ({ key, equals: value })),
      maxInvocations: entry.maxInvocations,
    }));
}

function normalizedInput(
  plan: CandidatePlan,
  accepted: readonly CandidatePlanNode[],
  registryVersion: string,
) {
  return {
    schemaVersion: plan.schemaVersion,
    taskId: plan.taskId,
    registryVersion,
    acceptedNodes: accepted.map((n) => ({
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

function normalizedOutput(contract: Omit<CompiledContract, "inputHash" | "outputHash">) {
  return {
    specVersion: contract.specVersion,
    allowedActions: contract.allowedActions,
    forbiddenResources: [...contract.forbiddenResources].sort(),
    forbiddenOperations: [...contract.forbiddenOperations].sort(),
    ephemeralLimits: contract.ephemeralLimits,
    dataFlowBindings: contract.dataFlowBindings,
    requiredApprovals: [...contract.requiredApprovals].sort(),
    registryVersion: contract.registryVersion,
    compilerVersion: contract.compilerVersion,
    selectedPermissionIds: contract.selectedPermissionIds,
    excessOperations: contract.excessOperations,
  };
}

export function compileContract(input: CompileContractInput): CompiledContract {
  const { candidatePlan, validation, solverOutcome, registry } = input;

  const accepted = acceptedNodes(candidatePlan, validation);
  if (accepted.length === 0) {
    throw new CompilationError("no accepted plan nodes to compile a contract from");
  }

  const deniedTools = [
    ...new Set(validation.findings.filter((f) => f.status === "denied").map((f) => f.nodeId)),
  ]
    .map((nodeId) => candidatePlan.nodes.find((n) => n.id === nodeId)?.tool)
    .filter((t): t is string => Boolean(t));

  const requiredApprovals = [
    ...new Set(accepted.filter((n) => registry.operations.get(n.tool)?.requiresApproval).map((n) => n.tool)),
  ].sort();

  const dataFlowBindings = accepted.flatMap((n) => n.dataFlowRefs);

  const totalInvocations = accepted.reduce((sum, n) => sum + n.maxInvocations, 0);

  const withoutHashes: Omit<CompiledContract, "inputHash" | "outputHash"> = {
    specVersion: SPEC_VERSION,
    allowedActions: buildAllowedActions(accepted),
    forbiddenResources: [],
    forbiddenOperations: [...new Set(deniedTools)].sort(),
    ephemeralLimits: {
      maxToolInvocations: totalInvocations,
      expiresInSeconds: DEFAULT_CONTRACT_EXPIRY_SECONDS,
    },
    dataFlowBindings,
    requiredApprovals,
    registryVersion: registry.registryVersion,
    compilerVersion: COMPILER_VERSION,
    selectedPermissionIds: solverOutcome.solution.selectedPermissionIds,
    excessOperations: solverOutcome.solution.excessOperations,
  };

  const inputHash = canonicalHash(normalizedInput(candidatePlan, accepted, registry.registryVersion));
  const outputHash = canonicalHash(normalizedOutput(withoutHashes));

  return { ...withoutHashes, inputHash, outputHash };
}
