import { z } from "zod";

import { timestampSchema, toolArgumentsSchema, toolNameSchema } from "./common";
import { probabilitySchema } from "./semantic-decision";

/**
 * Semantic-risk evidence (Part 5, extended in Part 6).
 *
 * This is an *observation* produced by a provider and validated by our own
 * code. No type in this module can express a decision, a permission, a budget or
 * a capability, and every schema is `.strict()`: a provider (or anything forging
 * one's output) that returns an extra field such as `decision`, `allow` or
 * `grantedTools` fails validation rather than being carried along.
 *
 * `authoritative: false` on an evidence object means the *object itself* never
 * carries authority. In `enforce` mode a semantic result influences an outcome
 * only by being fed to `gateway.compose_outcome()` inside the database, which can
 * only narrow a deterministic allow (see docs/gateway/TRUST_MODEL.md).
 *
 * Direction of each signal is stated explicitly because it is not uniform:
 * `taskAlignment` and `resourceRelevance` are *higher = more consistent with
 * the task*; every other signal is *higher = riskier*.
 */

export const SEMANTIC_MODES = ["off", "shadow", "enforce"] as const;
export const semanticModeSchema = z.enum(SEMANTIC_MODES);
export type SemanticMode = z.infer<typeof semanticModeSchema>;

export const SEMANTIC_PROVIDERS = ["mock", "openai_compatible", "legacy_lexical"] as const;
export const semanticProviderNameSchema = z.enum(SEMANTIC_PROVIDERS);
export type SemanticProviderName = z.infer<typeof semanticProviderNameSchema>;

export const SEMANTIC_INDICATORS = [
  "prompt_injection_phrase",
  "instruction_override",
  "secret_material_in_arguments",
  "encoded_payload",
  "external_recipient",
  "unrelated_resource_identifier",
  "cross_repository_reference",
  "amount_escalation",
  "tool_not_in_plan",
  "plan_step_skipped",
  "unexpected_side_effect",
  "high_entropy_blob",
  "destructive_action_unrequested",
  "ambiguous_task",
] as const;
export const semanticIndicatorSchema = z.enum(SEMANTIC_INDICATORS);
export type SemanticIndicator = z.infer<typeof semanticIndicatorSchema>;

export const semanticSignalsSchema = z
  .object({
    /** Higher = the action serves the trusted task intent. */
    taskAlignment: probabilitySchema,
    /** Higher = the targeted resources are the ones the task concerns. */
    resourceRelevance: probabilitySchema,
    /** Higher = reaches beyond the contract's intended scope. */
    scopeExpansion: probabilitySchema,
    /** Higher = more likely to disclose data outside the organization. */
    externalDisclosure: probabilitySchema,
    /** Higher = arguments look like instructions aimed at the agent or a model. */
    promptInjection: probabilitySchema,
    /** Higher = arguments diverge suspiciously from earlier calls or the task. */
    suspiciousArgumentChange: probabilitySchema,
    /** Higher = departs from the plan / contract sequence. */
    planDeviation: probabilitySchema,
  })
  .strict();
export type SemanticSignals = z.infer<typeof semanticSignalsSchema>;

export const semanticEvidenceStateSchema = z.enum(["ok", "timeout", "error", "unavailable", "circuit_open"]);
export type SemanticEvidenceState = z.infer<typeof semanticEvidenceStateSchema>;

export const semanticRiskLevelSchema = z.enum(["low", "medium", "high", "critical", "unknown"]);
export type SemanticRiskLevel = z.infer<typeof semanticRiskLevelSchema>;

export const semanticDisagreementSchema = z.enum([
  "none",
  "semantic_flags_permitted",
  "semantic_clears_denied",
]);
export type SemanticDisagreement = z.infer<typeof semanticDisagreementSchema>;

/** The raw shape a provider must return. `.strict()`: anything extra is rejected. */
export const providerSignalPayloadSchema = z
  .object({
    signals: semanticSignalsSchema,
    indicators: z.array(semanticIndicatorSchema).max(16),
    confidence: probabilitySchema,
  })
  .strict();
export type ProviderSignalPayload = z.infer<typeof providerSignalPayloadSchema>;

export const redactionSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    counts: z.record(z.string(), z.number().int().nonnegative()),
    truncated: z.boolean(),
    decodedSegments: z.number().int().nonnegative(),
    inputBytes: z.number().int().nonnegative(),
  })
  .strict();
export type RedactionSummary = z.infer<typeof redactionSummarySchema>;

/**
 * A completed (or degraded) evaluation, ready to persist. `authoritative` is
 * the literal `false` — not a boolean — so it cannot be constructed as true.
 */
export const semanticEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("shadow"),
    authoritative: z.literal(false),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    modelVersion: z.string().min(1).max(100),
    state: semanticEvidenceStateSchema,
    signals: semanticSignalsSchema.nullable(),
    indicators: z.array(semanticIndicatorSchema).max(16),
    confidence: probabilitySchema,
    riskLevel: semanticRiskLevelSchema,
    latencyMs: z.number().int().nonnegative(),
    inputHash: z.string().regex(/^[0-9a-f]{64}$/),
    redaction: redactionSummarySchema,
    errorCategory: z
      .string()
      .regex(/^[a-z_]{1,40}$/)
      .optional(),
    evaluatedAt: timestampSchema,
  })
  .strict()
  .refine((e) => (e.state === "ok") === (e.signals !== null), {
    message: "signals must be present exactly when state is ok",
  })
  .refine((e) => e.state === "ok" || e.riskLevel === "unknown", {
    message: "a non-ok evaluation must have unknown risk",
  });
export type SemanticEvidence = z.infer<typeof semanticEvidenceSchema>;

/** Trusted, persisted context for one evaluation — built from database rows, never from the caller. */
export const semanticRiskInputSchema = z
  .object({
    taskIntent: z.string().min(1),
    tool: toolNameSchema,
    operation: z.string().min(1),
    resource: z.string().nullable(),
    arguments: toolArgumentsSchema,
    contractAllowedTools: z.array(toolNameSchema),
    priorCalls: z.array(z.object({ tool: toolNameSchema, arguments: toolArgumentsSchema }).strict()).max(5),
  })
  .strict();
export type SemanticRiskInput = z.infer<typeof semanticRiskInputSchema>;
