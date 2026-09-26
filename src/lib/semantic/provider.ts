import type { SemanticRiskInput } from "@/lib/domain";

/**
 * Production-grade semantic-risk provider port (Part 5).
 *
 * Extends the Part 1 `SemanticDecisionProvider` idea (see
 * `lib/authorization/semantic-decision-provider.ts`, still used by the
 * pre-existing evaluator) with the signals a runtime shadow evaluation needs.
 * `LegacyLexicalProvider` adapts the original port onto this one, which is
 * also what makes provider-to-provider disagreement measurable.
 *
 * Hard boundaries, kept structural rather than promised:
 *
 * - `evaluate()` receives only a redacted `SemanticRiskInput` — no secrets,
 *   no credentials, no other tenant's data ever reaches an implementation.
 * - It returns `unknown`. The runner validates that against a `.strict()`
 *   schema, so a provider cannot return a decision, a grant, a budget or any
 *   field this contract does not define — an unexpected key is a failure.
 * - It cannot see or call anything that mints a capability, activates a
 *   contract or changes a policy: nothing of that kind is in scope here.
 */
export interface SemanticProviderIdentity {
  /** Stable name recorded on every evidence row, e.g. "mock". */
  readonly name: string;
  readonly model: string;
  readonly modelVersion: string;
}

export interface SemanticProviderCall {
  /** Aborted when the runner's deadline passes; implementations must honor it. */
  signal: AbortSignal;
}

export interface SemanticRiskProvider extends SemanticProviderIdentity {
  evaluate(input: SemanticRiskInput, call: SemanticProviderCall): Promise<unknown>;
}

export class SemanticProviderError extends Error {
  /** Lowercase snake_case category, safe to persist. */
  readonly category: string;
  constructor(category: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SemanticProviderError";
    this.category = category;
  }
}

/** Thrown when the provider is not configured (e.g. missing API key) — reported as `unavailable`, not `error`. */
export class SemanticProviderUnavailableError extends SemanticProviderError {
  constructor(message: string) {
    super("unavailable", message);
    this.name = "SemanticProviderUnavailableError";
  }
}
