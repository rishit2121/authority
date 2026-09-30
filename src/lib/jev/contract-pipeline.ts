import "server-only";

import { canonicalHash } from "@/lib/authorization/canonicalize";
import { computeBackwardSlice } from "@/lib/authorization/backward-slice";
import type {
  PlanNodeFinding,
  PlanNodeFindingStatus,
  PlanValidationResult,
} from "@/lib/authorization/plan-validator";
import type { CandidatePlan, Policy } from "@/lib/domain";
import type { LoadedRegistry } from "@/lib/registry";
import type { CircuitBreaker } from "@/lib/semantic/circuit-breaker";

import type { JevNecessityProvider, NecessityPlanNodeSummary } from "./necessity-provider";
import {
  DEFAULT_NECESSITY_TIMEOUT_MS,
  runNecessityEvaluation,
  type NecessityRunResult,
} from "./necessity-runner";

/**
 * Necessity evaluation is opt-in per tenant, mirroring the existing semantic-risk `off | shadow | enforce`
 * vocabulary and its safest-by-default posture:
 *
 *  - `off` (default): the pipeline behaves exactly as it did before this feature existed. No Jev call is made.
 *  - `shadow`: Jev necessity runs for every mechanically-included, in-slice node and is fully recorded (see
 *    `lib/domain` persistence types), but never changes which nodes reach the solver — useful for evaluating Jev's
 *    accuracy against real plans before trusting it with anything.
 *  - `enforce`: the combination rules below actually gate the plan (see docs/jev/OVERVIEW.md for the full rule
 *    table). An admin must explicitly choose this; it is never the default for a newly configured tenant.
 */
export const NECESSITY_MODES = ["off", "shadow", "enforce"] as const;
export type NecessityMode = (typeof NECESSITY_MODES)[number];

export interface JevNodeRecord {
  nodeId: string;
  tool: string;
  mechanicalStatus: PlanNodeFindingStatus;
  inBackwardSlice: boolean;
  /** null when necessity evaluation did not run for this node (mode "off", node not mechanically included, or outside the slice). */
  necessityRun: NecessityRunResult | null;
  /** SHA-256 of the exact trusted input Jev was (or would have been) given for this node — null exactly when `necessityRun` is null. */
  inputHash: string | null;
  finalStatus: PlanNodeFindingStatus;
  /** True when Jev's classification would have led to a different disposition than the mechanical result alone — recorded even in shadow mode. */
  disagreement: boolean;
  reasons: string[];
}

export interface JevContractPipelineResult {
  /** Same shape and invariants as `PlanValidationResult` — safe to pass directly into `solveMinimumAuthority`/`compileContract` unchanged. */
  adjustedValidation: PlanValidationResult;
  nodeRecords: JevNodeRecord[];
  outsideSliceNodeIds: string[];
  mode: NecessityMode;
}

export interface JevContractPipelineOptions {
  candidatePlan: CandidatePlan;
  /** The stored, trusted task objective — never anything agent- or user-supplied at plan-generation time. */
  taskIntent: string;
  validation: PlanValidationResult;
  registry: LoadedRegistry;
  activePolicies: readonly Policy[];
  mode: NecessityMode;
  /** null when Jev necessity is unconfigured — `mode` is then forced to behave as "off" regardless of the tenant setting, and this is recorded via every node's `necessityRun` staying null. */
  provider: JevNecessityProvider | null;
  breaker?: CircuitBreaker;
  timeoutMs?: number;
  /** Untrusted, agent-supplied justification per node id, if the agent provided one — never the registry's trusted description. */
  agentJustifications?: Record<string, string | null>;
}

function planSummaries(plan: CandidatePlan): NecessityPlanNodeSummary[] {
  return plan.nodes.map((n) => ({
    id: n.id,
    tool: n.tool,
    sideEffect: n.expectedSideEffect,
    dependencies: n.dependencies,
    dataFlowFromNodeIds: [...new Set(n.dataFlowRefs.map((r) => r.fromNodeId))],
  }));
}

/**
 * Runs backward-slice + (when enabled) Jev necessity evaluation over a mechanically-validated plan, and produces an
 * adjusted `PlanValidationResult` reflecting the combination rules. Never touches the solver or compiler; the
 * caller passes `adjustedValidation` to them exactly as it would have passed the original mechanical result.
 */
export async function runJevContractPipeline(
  options: JevContractPipelineOptions,
): Promise<JevContractPipelineResult> {
  const { candidatePlan: plan, validation, registry } = options;
  const slice = computeBackwardSlice(plan, validation.includedNodeIds);
  const outsideSlice = new Set(slice.outsideSliceNodeIds);
  const summaries = planSummaries(plan);
  const effectiveMode: NecessityMode = options.provider ? options.mode : "off";

  const nodeRecords: JevNodeRecord[] = [];
  const overlay = new Map<string, PlanNodeFinding>();

  for (const finding of validation.findings) {
    const node = plan.nodes.find((n) => n.id === finding.nodeId)!;
    const included = finding.status === "accepted" || finding.status === "requires_review";
    const inSlice = !outsideSlice.has(finding.nodeId);

    if (!included) {
      // Mechanically rejected already (denied/clarify/replan) — Jev is never consulted, and this can never be
      // resurrected by anything below. Unconditional, same tier as an unknown registry operation.
      overlay.set(finding.nodeId, finding);
      nodeRecords.push({
        nodeId: finding.nodeId,
        tool: node.tool,
        mechanicalStatus: finding.status,
        inBackwardSlice: inSlice,
        necessityRun: null,
        inputHash: null,
        finalStatus: finding.status,
        disagreement: false,
        reasons: finding.reasons,
      });
      continue;
    }

    if (!inSlice) {
      // Outside the plan's own mechanical backward slice — rejected regardless of Jev (section 3's combination rules).
      const status: PlanNodeFindingStatus = "replan";
      overlay.set(finding.nodeId, {
        nodeId: finding.nodeId,
        status,
        reasons: [
          ...finding.reasons,
          "not reachable from any of the plan's own terminal effects (mechanical backward slice)",
        ],
      });
      nodeRecords.push({
        nodeId: finding.nodeId,
        tool: node.tool,
        mechanicalStatus: finding.status,
        inBackwardSlice: false,
        necessityRun: null,
        inputHash: null,
        finalStatus: status,
        disagreement: false,
        reasons: ["outside_backward_slice"],
      });
      continue;
    }

    if (effectiveMode === "off" || !options.provider) {
      overlay.set(finding.nodeId, finding);
      nodeRecords.push({
        nodeId: finding.nodeId,
        tool: node.tool,
        mechanicalStatus: finding.status,
        inBackwardSlice: true,
        necessityRun: null,
        inputHash: null,
        finalStatus: finding.status,
        disagreement: false,
        reasons: finding.reasons,
      });
      continue;
    }

    const registryOp = registry.operations.get(node.tool)!;
    const necessityInput = {
      taskId: plan.taskId,
      taskIntent: options.taskIntent,
      plan: summaries,
      nodeId: finding.nodeId,
      inBackwardSlice: true,
      registryOperation: {
        id: registryOp.id,
        provider: registryOp.provider,
        sideEffect: registryOp.sideEffect,
        resourceType: registryOp.resourceType,
        dataSensitivity: registryOp.dataSensitivity,
        preconditions: registryOp.preconditions,
        effects: registryOp.effects,
        alternativeOperationIds: registryOp.alternativeOperationIds,
      },
      activePolicySummaries: options.activePolicies.map((p) => `${p.effect}: ${p.name}`),
      agentJustification: options.agentJustifications?.[finding.nodeId] ?? null,
    };
    const inputHash = canonicalHash(necessityInput);
    const run = await runNecessityEvaluation({
      provider: options.provider,
      breaker: options.breaker,
      timeoutMs: options.timeoutMs ?? DEFAULT_NECESSITY_TIMEOUT_MS,
      input: necessityInput,
    });

    const { status, disagreement, reasons } = applyNecessityRule(finding, run, effectiveMode);
    overlay.set(finding.nodeId, { nodeId: finding.nodeId, status, reasons });
    nodeRecords.push({
      nodeId: finding.nodeId,
      tool: node.tool,
      mechanicalStatus: finding.status,
      inBackwardSlice: true,
      necessityRun: run,
      inputHash,
      finalStatus: status,
      disagreement,
      reasons,
    });
  }

  const orderedFindings = validation.findings.map((f) => overlay.get(f.nodeId) ?? f);
  const acceptedNodeIds = orderedFindings.filter((f) => f.status === "accepted").map((f) => f.nodeId);
  const includedNodeIds = orderedFindings
    .filter((f) => f.status === "accepted" || f.status === "requires_review")
    .map((f) => f.nodeId);
  const includedNodes = plan.nodes.filter((n) => includedNodeIds.includes(n.id));
  const requiredOperations = [...new Set(includedNodes.map((n) => n.tool))].sort();

  return {
    adjustedValidation: { findings: orderedFindings, acceptedNodeIds, includedNodeIds, requiredOperations },
    nodeRecords,
    outsideSliceNodeIds: slice.outsideSliceNodeIds,
    mode: effectiveMode,
  };
}

function applyNecessityRule(
  mechanical: PlanNodeFinding,
  run: NecessityRunResult,
  mode: NecessityMode,
): { status: PlanNodeFindingStatus; disagreement: boolean; reasons: string[] } {
  // Shadow mode: fully evaluated and recorded, never changes the outcome.
  if (mode === "shadow" || run.state !== "ok" || !run.evaluation) {
    if (mode === "shadow") {
      const disagreement =
        run.state === "ok" && run.evaluation
          ? classificationDisagrees(mechanical.status, run.evaluation.classification)
          : false;
      return { status: mechanical.status, disagreement, reasons: mechanical.reasons };
    }
    // enforce mode, but Jev did not return a usable result: never treat the tool as approved.
    return {
      status: mechanical.status === "accepted" ? "requires_review" : mechanical.status,
      disagreement: false,
      reasons: [...mechanical.reasons, `jev necessity evaluation ${run.state}: not treated as approved`],
    };
  }

  const { classification, reasonCodes } = run.evaluation;
  const disagreement = classificationDisagrees(mechanical.status, classification);
  switch (classification) {
    case "unjustified":
      return {
        status: "replan",
        disagreement,
        reasons: [...mechanical.reasons, `jev: unjustified (${reasonCodes.join(", ") || "no reason codes"})`],
      };
    case "ambiguous":
      return {
        status: "clarify",
        disagreement,
        reasons: [...mechanical.reasons, "jev: ambiguous — insufficient trusted information"],
      };
    case "conditional":
      // No machine-verifiable-condition mechanism exists yet (see docs/jev/OVERVIEW.md's limitations) — the safe
      // current treatment is the same escalation the mechanical validator already uses for anything it cannot
      // resolve deterministically: human review before activation, never silent approval.
      return {
        status: mechanical.status === "denied" ? mechanical.status : "requires_review",
        disagreement,
        reasons: [
          ...mechanical.reasons,
          "jev: conditional — requires human review pending a machine-verifiable condition",
        ],
      };
    case "required":
      // Never upgrades; Jev cannot grant anything on its own, so a mechanical requires_review stays requires_review.
      return { status: mechanical.status, disagreement, reasons: mechanical.reasons };
  }
}

function classificationDisagrees(mechanicalStatus: PlanNodeFindingStatus, classification: string): boolean {
  const mechanicalAccepts = mechanicalStatus === "accepted" || mechanicalStatus === "requires_review";
  const jevAccepts = classification === "required" || classification === "conditional";
  return mechanicalAccepts !== jevAccepts;
}
