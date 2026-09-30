/**
 * Jev's typed outputs and the trusted inputs it is given, per Authority's own domain — deliberately not the same
 * shape as OpenRouter's raw Decisions API response (see `lib/openrouter/client.ts`'s `DecisionsResult`); these are
 * Authority's stable, versioned contract with the rest of the codebase, adapted from Jev's actual choice/noul/score
 * primitives rather than a free-form schema Jev cannot natively produce. See docs/jev/OVERVIEW.md.
 */

export const NECESSITY_CLASSIFICATIONS = ["required", "conditional", "unjustified", "ambiguous"] as const;
export type NecessityClassification = (typeof NECESSITY_CLASSIFICATIONS)[number];

export const NECESSITY_REASON_CODES = [
  "direct_task_requirement",
  "required_dependency",
  "required_data_source",
  "required_side_effect",
  "duplicate_operation",
  "unrelated_resource",
  "unrequested_side_effect",
  "less_privileged_alternative",
  "missing_task_information",
  "plan_dependency_conflict",
] as const;
export type NecessityReasonCode = (typeof NECESSITY_REASON_CODES)[number];

/** A small, closed vocabulary — Jev picks among these, it never invents a free-form "what's missing" string. */
export const MISSING_INFORMATION_CODES = [
  "resource_identifier",
  "recipient_identifier",
  "amount_or_quantity",
  "target_branch_or_environment",
  "time_window",
] as const;
export type MissingInformationCode = (typeof MISSING_INFORMATION_CODES)[number];

export interface ToolNecessityEvaluation {
  classification: NecessityClassification;
  /** From the classification `choice` question's own `confidence` (0-1). */
  confidence: number;
  reasonCodes: NecessityReasonCode[];
  /** Always a subset of the node's own declared `dependencies` — Jev is never asked about, and can never name, a node outside that allowlist. */
  requiredPredecessorNodeIds: string[];
  missingInformationCodes: MissingInformationCode[];
  /** Always a subset of the registry operation's own `alternativeOperationIds` — never invented. */
  alternativeOperationIds: string[];
}

export const RISK_CLASSES = ["low", "medium", "high", "critical"] as const;
export type JevRiskClass = (typeof RISK_CLASSES)[number];

export const RISK_CATEGORIES = [
  "prompt_injection",
  "task_divergence",
  "resource_substitution",
  "recipient_substitution",
  "argument_escalation",
  "unrequested_side_effect",
  "secret_access",
  "cross_tenant_attempt",
  "capability_misuse",
  "suspicious_sequence",
  "none",
] as const;
export type JevRiskCategory = (typeof RISK_CATEGORIES)[number];

/** A small, closed vocabulary of what could have been observed — Jev selects among these, never free text. */
export const RISK_EVIDENCE_CODES = [
  "argument_differs_from_plan",
  "resource_differs_from_plan",
  "recipient_differs_from_plan",
  "amount_exceeds_plan",
  "operation_not_in_plan",
  "unusual_call_sequence",
  "repeated_after_denial",
  "near_budget_exhaustion",
  "sensitive_resource_pattern",
  "contract_near_expiry",
] as const;
export type RiskEvidenceCode = (typeof RISK_EVIDENCE_CODES)[number];

export interface ToolRiskEvaluation {
  riskClass: JevRiskClass;
  /** From the risk-class `choice` question's own `confidence` (0-1). */
  confidence: number;
  categories: JevRiskCategory[];
  evidenceCodes: RiskEvidenceCode[];
}

export interface JevProviderIdentity {
  readonly name: string;
  readonly model: string;
  readonly modelVersion: string;
}

export class JevProviderError extends Error {
  readonly category: string;
  constructor(category: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JevProviderError";
    this.category = category;
  }
}

/** Not configured — a normal, supported state (necessity/risk evaluation is then simply not run for the tenant). */
export class JevProviderUnavailableError extends JevProviderError {
  constructor(message: string) {
    super("unavailable", message);
    this.name = "JevProviderUnavailableError";
  }
}

export const COMPLETENESS_CLASSIFICATIONS = [
  "complete",
  "missing_information",
  "missing_capability_category",
  "internally_inconsistent",
  "unnecessarily_privileged",
] as const;
export type CompletenessClassification = (typeof COMPLETENESS_CLASSIFICATIONS)[number];

export interface PlanCompletenessEvaluation {
  classification: CompletenessClassification;
  confidence: number;
  /** Always a subset of the candidate registry operation ids supplied to Jev — never an invented tool. */
  possibleMissingOperationIds: string[];
}
