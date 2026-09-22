import type { SemanticDecisionInput, SemanticDecisionResult } from "@/lib/domain";

/**
 * Provider-neutral semantic evaluation port.
 *
 * Production will back this with Jev for fast runtime semantic evaluation
 * (task-to-action alignment, resource relevance, scope expansion, external
 * disclosure, plan consistency, semantic risk). Jev returns structured
 * probabilities as *evidence* only.
 *
 * Hard boundaries, enforced by keeping this port narrow:
 *
 * - A provider receives no credentials and cannot reach a credential store.
 * - A provider cannot mint or extend a capability.
 * - A provider cannot override a hard-deny policy rule.
 * - A provider cannot widen the Task Authority Contract.
 * - A provider cannot independently approve a high-risk operation.
 *
 * The provider therefore returns data, never a decision. Only the
 * deterministic evaluator in `evaluate.ts` produces an
 * `AuthorizationDecision`, and it treats a timeout or error as "no evidence"
 * rather than as permission. Nothing outside this file and its
 * implementations may name a specific vendor.
 */
export interface SemanticDecisionProvider {
  /** Stable identifier recorded on every result, e.g. "mock" or "jev". */
  readonly name: string;

  /**
   * Evaluate one request. Implementations must resolve rather than throw —
   * a failure is reported as `state: "error"` so the evaluator can fall back
   * to deterministic policy alone.
   */
  evaluate(
    input: SemanticDecisionInput,
    options?: SemanticEvaluationOptions,
  ): Promise<SemanticDecisionResult>;
}

export interface SemanticEvaluationOptions {
  /** Upper bound on provider latency; exceeding it yields `state: "timeout"`. */
  timeoutMs?: number;
}

export const DEFAULT_SEMANTIC_TIMEOUT_MS = 250;

/**
 * Evidence is only usable when the provider actually completed. This is a
 * plain predicate rather than a type guard: the distinction it draws is on
 * `state`, not on the shape of the result, and a type guard here would narrow
 * the negative branch to `never`.
 */
export function hasUsableEvidence(result: SemanticDecisionResult | undefined): boolean {
  return result !== undefined && result.state === "ok";
}
