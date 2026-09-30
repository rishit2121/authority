import "server-only";

/**
 * The AI plan-generation boundary.
 *
 * Everything on this file's `TrustedTaskInput` side is either operator-
 * authored (the task intent) or audited registry/policy data this
 * application already trusts. Everything a `PlanProposalProvider` returns is
 * the opposite: an **untrusted** candidate plan that must run through the
 * exact same deterministic pipeline (schema validation → plan validation →
 * policy evaluation → solver → compiler → verifier) as a hand-authored one
 * — see `src/app/app/tasks/[taskId]/contract/actions.ts`'s
 * `generatePlanWithAiAction`. A provider implementation never gets to skip
 * that pipeline, never selects a permission, never activates anything, and
 * is never given Supabase or integration credentials.
 *
 * No `PlanProposalProvider` implementation may weaken this boundary. In
 * particular:
 *  - It must not retry indefinitely or silently swap to a different model
 *    on failure — a provider failure surfaces as a typed error, and the
 *    caller decides whether to fall back to manual plan entry.
 *  - It must bound output size and enforce a timeout itself, not rely on
 *    the caller to notice a hang.
 *  - It must return exactly the shape below — raw text, not a parsed and
 *    trusted `CandidatePlan` — the caller performs its own strict
 *    validation regardless of what the provider claims to have already
 *    validated.
 */

export interface TrustedToolDescriptor {
  id: string;
  provider: string;
  sideEffect: string;
  resourceType: string;
  dataSensitivity: string;
  externalCommunication: boolean;
  financialImpact: boolean;
  argumentFields: {
    key: string;
    type: string;
    required: boolean;
    identifiesResource: boolean;
  }[];
}

/**
 * Everything a plan-generation provider is given. Deliberately narrow:
 *
 *  - `taskIntent` is the operator-authored trusted task text — never raw
 *    database contents, never another tenant's data.
 *  - `availableTools` is the registry's own operation descriptors — audited
 *    code, safe to disclose to a model whose output will be independently
 *    re-validated against that same registry regardless.
 *  - `policySummaries` are short, human-readable descriptions of the
 *    tenant's active deny/require-approval policies (e.g. "deny: resource
 *    matching *secret*") — enough for the model to avoid an obviously
 *    doomed plan, never the tenant's raw policy row or internal ids.
 *  - `resourceReferences` are resource identifiers the caller explicitly
 *    extracted from the trusted task text (e.g. a repository name typed by
 *    the user) — never inferred from anything outside the task itself.
 *
 * No secrets, credentials, other tenants' data, or raw database rows are
 * ever part of this type — there is no field here that could carry one.
 */
export interface TrustedTaskInput {
  taskId: string;
  taskIntent: string;
  availableTools: TrustedToolDescriptor[];
  policySummaries: string[];
  resourceReferences: string[];
}

export interface PlanProposalMetadata {
  provider: string;
  model: string;
  /** The provider implementation's own version string, for audit trails — never a claim about the plan's correctness. */
  providerVersion: string;
  /**
   * The model that actually answered, when the provider is a router (e.g. OpenRouter's `typesafe/jev-router`) that
   * may not use exactly the model named in `model`. Omitted by providers that call one fixed model directly (e.g.
   * OpenAI), where `model` already is the actual model.
   */
  respondedModel?: string;
}

/**
 * A provider's raw response: unvalidated JSON plus disclosure metadata. The
 * caller runs this through `candidatePlanSchema.safeParse` before treating
 * it as anything — `plan` here is `unknown` on purpose, not `CandidatePlan`,
 * so a provider implementation cannot short-circuit that validation by
 * asserting a type.
 */
export interface PlanProposalResult {
  plan: unknown;
  metadata: PlanProposalMetadata;
}

export class PlanProposalTimeoutError extends Error {}
export class PlanProposalOutputTooLargeError extends Error {}
export class PlanProposalProviderError extends Error {}

export interface PlanProposalProvider {
  proposePlan(input: TrustedTaskInput): Promise<PlanProposalResult>;
}

/** Fixed label the UI must always show next to AI-generated content. Not decorative — see UI module docs. */
export const UNTRUSTED_AI_PLAN_LABEL = "Untrusted AI-proposed execution plan";
