import {
  isPermitted,
  type AllowedAction,
  type AuthorizationDecision,
  type DecisionReason,
  type DecisionStatus,
  type ResourceConstraint,
  type SemanticDecisionResult,
  type TaskAuthorityContract,
  type ToolArguments,
  type ToolRequest,
} from "@/lib/domain";

import {
  DEFAULT_SEMANTIC_TIMEOUT_MS,
  hasUsableEvidence,
  type SemanticDecisionProvider,
} from "./semantic-decision-provider";

/**
 * Deterministic authorization evaluator.
 *
 * Order of operations is deliberate and load-bearing:
 *
 *   1. Hard-deny policy    — forbidden resources, never overridable
 *   2. Contract membership — tool must be an allowed action
 *   3. Constraint matching — arguments must satisfy the contract's limits
 *   4. Invocation limits   — budget must remain
 *   5. Semantic evidence   — may only *narrow*, never widen
 *
 * Semantic evidence is consulted last and can only downgrade an outcome. A
 * provider that times out or errors yields no evidence, and the deterministic
 * result stands — a degraded provider must never become a way to get a yes.
 */

export interface EvaluationThresholds {
  /** Below this task relevance, ask the agent to replan. */
  minTaskRelevance: number;
  /** At or above this disclosure risk, route to a human. */
  maxExternalDisclosure: number;
  /** At or above this aggregate risk, route to a human. */
  maxSemanticRisk: number;
  /** Below this confidence, evidence is treated as inconclusive. */
  minConfidence: number;
}

export const DEFAULT_THRESHOLDS: EvaluationThresholds = {
  minTaskRelevance: 0.35,
  maxExternalDisclosure: 0.7,
  maxSemanticRisk: 0.75,
  minConfidence: 0.3,
};

export interface EvaluateOptions {
  contract: TaskAuthorityContract;
  request: ToolRequest;
  /** Omit to decide on deterministic policy alone. */
  semanticProvider?: SemanticDecisionProvider;
  /** Trusted user intent, required when a semantic provider is supplied. */
  taskIntent?: string;
  priorPlanTools?: string[];
  thresholds?: Partial<EvaluationThresholds>;
  /**
   * Invocations already spent under this contract version. This in-memory evaluator models only the contract-wide
   * total; per-action and task-wide budgets (which span contract versions, 20261027000001) are enforced in SQL by
   * gateway.evaluate_deterministic.
   */
  usedInvocations?: number;
  now?: () => Date;
  idFactory?: () => string;
}

export interface EvaluationOutcome {
  decision: AuthorizationDecision;
  /** Present when a provider ran, including on timeout or error. */
  evidence?: SemanticDecisionResult;
}

function matchesGlob(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

/** Forbidden entries are globs matched against the tool and every argument. */
function matchesForbidden(pattern: string, request: ToolRequest): boolean {
  const candidates = [request.tool, ...Object.values(request.arguments).flat().map(String)];
  return candidates.some((candidate) => matchesGlob(pattern, candidate.toLowerCase()));
}

function argumentValue(args: ToolArguments, key: string): string | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw.join(",") : String(raw);
}

function unsatisfiedConstraints(action: AllowedAction, request: ToolRequest): ResourceConstraint[] {
  return action.constraints.filter((constraint) => {
    const value = argumentValue(request.arguments, constraint.key);
    if (value === undefined) return true;
    if (constraint.equals !== undefined) return value !== constraint.equals;
    if (constraint.matches !== undefined) return !matchesGlob(constraint.matches, value);
    return false;
  });
}

/**
 * Keys the request supplies that the action neither pins nor declares open. Only actions compiled with
 * `openArguments` are closed-world; older actions (no field) accept any extra key, as before. Mirrors
 * gateway.evaluate_deterministic, where each such key counts as a failing (not missing) constraint.
 */
function undeclaredArguments(action: AllowedAction, request: ToolRequest): string[] {
  if (!action.openArguments) return [];
  const declared = new Set([...action.constraints.map((c) => c.key), ...action.openArguments]);
  return Object.keys(request.arguments).filter((key) => !declared.has(key));
}

/**
 * Decide whether one tool request is authorized under its contract.
 * Pure aside from the injected clock, id factory and provider.
 */
export async function evaluateToolRequest(options: EvaluateOptions): Promise<EvaluationOutcome> {
  const {
    contract,
    request,
    semanticProvider,
    taskIntent,
    priorPlanTools = [],
    usedInvocations = 0,
    now = () => new Date(),
    idFactory,
  } = options;

  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const startedAt = now().getTime();
  const reasons: DecisionReason[] = [];
  let status: DecisionStatus = "allow";
  let appliedConstraints: ResourceConstraint[] = [];
  // Declared up front: `finalize` closes over this and the early-return paths
  // below call it before any provider runs.
  let evidence: SemanticDecisionResult | undefined;

  // 1. Hard deny — checked first and never reconsidered.
  const forbidden = contract.forbiddenResources.find((pattern) => matchesForbidden(pattern, request));
  if (forbidden) {
    reasons.push({
      code: "FORBIDDEN_RESOURCE",
      detail: `Request matches the contract's forbidden resource \`${forbidden}\`.`,
      source: "policy",
    });
    return finalize("deny");
  }

  // 2. Contract membership. A tool may have several allowed actions (one per
  // distinct set of pinned arguments); the request is judged against the one
  // it satisfies, or -- when it satisfies none -- the closest one.
  const candidates = contract.allowedActions.filter((candidate) => candidate.tool === request.tool);
  const action =
    candidates.find(
      (candidate) =>
        unsatisfiedConstraints(candidate, request).length === 0 &&
        undeclaredArguments(candidate, request).length === 0,
    ) ??
    candidates.find((candidate) => {
      const u = unsatisfiedConstraints(candidate, request);
      return u.every((c) => argumentValue(request.arguments, c.key) === undefined);
    }) ??
    candidates[0];
  if (!action) {
    reasons.push({
      code: "TOOL_NOT_IN_CONTRACT",
      detail: `\`${request.tool}\` is not an allowed action on this Task Authority Contract.`,
      source: "contract",
    });
    return finalize("replan");
  }

  // 3. Constraint satisfaction, including closed-world arguments.
  const unsatisfied = unsatisfiedConstraints(action, request);
  const undeclared = undeclaredArguments(action, request);
  if (unsatisfied.length > 0 || undeclared.length > 0) {
    const missing = unsatisfied.filter((c) => argumentValue(request.arguments, c.key) === undefined);
    if (undeclared.length === 0 && missing.length === unsatisfied.length) {
      // Nothing conflicted; the request is simply underspecified.
      reasons.push({
        code: "ARGUMENTS_UNDERSPECIFIED",
        detail: `Missing constrained argument(s): ${missing.map((c) => c.key).join(", ")}.`,
        source: "contract",
      });
      return finalize("clarify");
    }
    reasons.push({
      code: "CONSTRAINT_VIOLATION",
      detail: `Arguments fall outside contract limits: ${[...unsatisfied.map((c) => c.key), ...undeclared].join(", ")}.`,
      source: "contract",
    });
    return finalize("deny");
  }

  // 4. Invocation budget.
  if (usedInvocations >= contract.ephemeralLimits.maxToolInvocations) {
    reasons.push({
      code: "INVOCATION_LIMIT_REACHED",
      detail: `This contract's ${contract.ephemeralLimits.maxToolInvocations}-invocation budget is exhausted.`,
      source: "limit",
    });
    return finalize("deny");
  }

  reasons.push({
    code: "WITHIN_CONTRACT",
    detail: `\`${request.tool}\` is permitted and its arguments satisfy every contract constraint.`,
    source: "contract",
  });

  // Constrained rather than plain allow whenever the contract narrows it.
  if (action.constraints.length > 0) {
    appliedConstraints = action.constraints;
    status = "allow_constrained";
  }

  // 5. Semantic evidence — advisory, narrowing-only.
  if (semanticProvider && taskIntent) {
    evidence = await semanticProvider.evaluate(
      {
        taskId: request.taskId,
        taskIntent,
        tool: request.tool,
        arguments: request.arguments,
        contractAllowedTools: contract.allowedActions.map((a) => a.tool),
        priorPlanTools,
      },
      { timeoutMs: DEFAULT_SEMANTIC_TIMEOUT_MS },
    );

    if (!hasUsableEvidence(evidence)) {
      reasons.push({
        code: "SEMANTIC_EVIDENCE_UNAVAILABLE",
        detail: `Semantic provider returned \`${evidence.state}\`; deterministic policy alone applies.`,
        source: "semantic",
      });
    } else if (evidence.overallConfidence < thresholds.minConfidence) {
      reasons.push({
        code: "SEMANTIC_LOW_CONFIDENCE",
        detail: "Semantic evidence was inconclusive and did not affect the outcome.",
        source: "semantic",
      });
    } else {
      status = applySemanticNarrowing(status, evidence, thresholds, reasons);
    }
  }

  return finalize(status);

  function finalize(finalStatus: DecisionStatus): EvaluationOutcome {
    const decidedAt = now();
    const decision: AuthorizationDecision = {
      id: idFactory?.() ?? `dec_${request.id}`,
      tenantId: request.tenantId,
      taskId: request.taskId,
      toolRequestId: request.id,
      status: finalStatus,
      reasons,
      appliedConstraints: isPermitted(finalStatus) ? appliedConstraints : [],
      semanticEvidence: evidence,
      latencyMs: Math.max(0, decidedAt.getTime() - startedAt),
      decidedAt: decidedAt.toISOString(),
    };
    return { decision, evidence };
  }
}

/**
 * Semantic signals may only move an outcome toward caution. There is no
 * branch here that upgrades a status, which is what keeps a model from
 * becoming a path to permission.
 */
function applySemanticNarrowing(
  current: DecisionStatus,
  evidence: SemanticDecisionResult,
  thresholds: EvaluationThresholds,
  reasons: DecisionReason[],
): DecisionStatus {
  if (evidence.taskRelevanceProbability < thresholds.minTaskRelevance) {
    reasons.push({
      code: "SEMANTIC_TASK_MISALIGNMENT",
      detail: `Action appears unrelated to the user's task (relevance ${evidence.taskRelevanceProbability.toFixed(2)}).`,
      source: "semantic",
    });
    return "replan";
  }

  if (evidence.externalDisclosureProbability >= thresholds.maxExternalDisclosure) {
    reasons.push({
      code: "SEMANTIC_EXTERNAL_DISCLOSURE",
      detail: `Possible disclosure outside the organization (${evidence.externalDisclosureProbability.toFixed(2)}); routing for approval.`,
      source: "semantic",
    });
    return "require_approval";
  }

  if (evidence.semanticRiskProbability >= thresholds.maxSemanticRisk) {
    reasons.push({
      code: "SEMANTIC_RISK",
      detail: `Aggregate semantic risk ${evidence.semanticRiskProbability.toFixed(2)} exceeds threshold; routing for approval.`,
      source: "semantic",
    });
    return "require_approval";
  }

  reasons.push({
    code: "SEMANTIC_CONSISTENT",
    detail: "Semantic evidence is consistent with the user's task.",
    source: "semantic",
  });
  return current;
}
