import { z } from "zod";

/**
 * Versioned domain model for the Validation Lab. Client-safe (no server imports): the same schemas validate
 * built-in scenarios, customer-authored scenarios, stored campaign records and report exports.
 *
 * Everything here is SYNTHETIC by construction: scenarios describe fake users, fake secrets and mock integrations.
 * Nothing in a scenario can name a host, a real integration credential or a repository: the only external effects a
 * campaign can have are the in-memory mocks in `engine/effects.ts` and `lib/github/mock.ts`.
 */

export const SCHEMA_VERSION = 1 as const;

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

export const DECISIONS = [
  "allow",
  "allow_constrained",
  "deny",
  "require_approval",
  "replan",
  "clarify",
] as const;
export const decisionSchema = z.enum(DECISIONS);
export type Decision = z.infer<typeof decisionSchema>;

/** The control that is responsible for a decision. */
export const CONTROLS = [
  "gateway_auth",
  "contract_scope",
  "argument_constraints",
  "policy",
  "budget",
  "semantic",
  "approval",
  "capability",
  "connector_guard",
  "connector_binding",
  "none",
] as const;
export const controlSchema = z.enum(CONTROLS);
export type Control = z.infer<typeof controlSchema>;

export const CATEGORIES = [
  "prompt_injection_direct",
  "prompt_injection_indirect",
  "secret_exfiltration",
  "recipient_substitution",
  "repository_substitution",
  "resource_substitution",
  "argument_escalation",
  "amount_escalation",
  "tool_substitution",
  "unplanned_calls",
  "plan_omission",
  "cross_tenant",
  "stale_contract",
  "stale_approval",
  "approval_bypass",
  "capability_theft",
  "capability_replay",
  "capability_broadening",
  "concurrency_race",
  "revocation",
  "semantic_failure",
  "semantic_disagreement",
  "schema_drift",
  "obfuscation",
  "benign_control",
] as const;
export const categorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof categorySchema>;

/** Why a step misbehaved / what the finding is about. */
export const CAUSES = [
  "invalid_plan",
  "missing_justification",
  "wrong_tool",
  "wrong_resource",
  "argument_constraint_violation",
  "policy_conflict",
  "missing_approval",
  "stale_contract",
  "capability_misuse",
  "prompt_injection",
  "semantic_uncertainty",
  "configuration_error",
] as const;
export const causeSchema = z.enum(CAUSES);
export type Cause = z.infer<typeof causeSchema>;

export const taxonomyRefSchema = z
  .object({
    framework: z.enum(["owasp-llm-2025", "owasp-agentic-t", "mitre-atlas"]),
    id: z.string().min(2).max(24),
    name: z.string().min(2).max(120),
  })
  .strict();
export type TaxonomyRef = z.infer<typeof taxonomyRefSchema>;

// ---------------------------------------------------------------------------
// Configuration patches (used by scenario variants AND by remediation proposals)
// ---------------------------------------------------------------------------

export const contractTransformSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add_constraint"),
      tool: z.string(),
      key: z.string(),
      equals: z.string().optional(),
      matches: z.string().optional(),
    })
    .strict(),
  z
    .object({ op: z.literal("reduce_invocations"), tool: z.string(), max: z.number().int().min(1).max(20) })
    .strict(),
  z.object({ op: z.literal("remove_action"), tool: z.string() }).strict(),
  // Weakening operations exist ONLY so scenario variants can model a permissive configuration.
  z.object({ op: z.literal("remove_constraint"), tool: z.string(), key: z.string() }).strict(),
  z
    .object({ op: z.literal("increase_invocations"), tool: z.string(), max: z.number().int().min(1).max(50) })
    .strict(),
]);
export type ContractTransform = z.infer<typeof contractTransformSchema>;

export const configPatchSchema = z
  .object({
    contractTransforms: z.array(contractTransformSchema).max(20).default([]),
    forbiddenResources: z.array(z.string().min(1).max(200)).max(20).default([]),
    forbiddenOperations: z.array(z.string().min(1).max(100)).max(20).default([]),
    /** Risk classes that require a human approval (replaces the environment's list). */
    approvalClasses: z.array(z.enum(["low", "medium", "high"])).optional(),
    semantic: z
      .object({
        mode: z.enum(["off", "shadow", "enforce"]).optional(),
        requiredClasses: z.array(z.enum(["low", "medium", "high"])).optional(),
      })
      .strict()
      .optional(),
    capabilityTtlSeconds: z.number().int().min(5).max(900).optional(),
  })
  .strict();
export type ConfigPatch = z.infer<typeof configPatchSchema>;

/** A patch is "narrowing" when it can only ever remove authority. Remediations must be narrowing. */
export function isNarrowingPatch(
  patch: ConfigPatch,
  base?: { approvalClasses?: string[]; semanticMode?: string; requiredClasses?: string[]; ttl?: number },
): boolean {
  for (const t of patch.contractTransforms) {
    if (t.op === "remove_constraint" || t.op === "increase_invocations") return false;
  }
  if (
    patch.approvalClasses &&
    base?.approvalClasses &&
    base.approvalClasses.some((c) => !patch.approvalClasses!.includes(c as never))
  )
    return false;
  const rank = { off: 0, shadow: 1, enforce: 2 } as const;
  if (
    patch.semantic?.mode &&
    base?.semanticMode &&
    rank[patch.semantic.mode] < rank[base.semanticMode as keyof typeof rank]
  )
    return false;
  if (
    patch.semantic?.requiredClasses &&
    base?.requiredClasses &&
    base.requiredClasses.some((c) => !patch.semantic!.requiredClasses!.includes(c as never))
  )
    return false;
  if (patch.capabilityTtlSeconds && base?.ttl && patch.capabilityTtlSeconds > base.ttl) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Scenario definition
// ---------------------------------------------------------------------------

export const semanticScriptSchema = z
  .object({
    /** `auto` runs the real mock heuristics on the redacted input; the others inject a provider fault or a fixed verdict. */
    mode: z.enum(["auto", "timeout", "error", "malformed", "extra_fields", "fixed"]).default("auto"),
    risk: z.enum(["low", "medium", "high", "critical"]).optional(),
    indicators: z.array(z.string().max(60)).max(8).optional(),
  })
  .strict();
export type SemanticScript = z.infer<typeof semanticScriptSchema>;

export const STEP_ACTIONS = [
  "authorize",
  "authorize_execute",
  "execute",
  "reauthorize",
  "fault",
  "revoke_capability",
] as const;

export const expectedOutcomeSchema = z
  .object({
    /** Acceptable FINAL decisions from the gateway. */
    decision: z.array(decisionSchema).min(1).optional(),
    capability: z.enum(["issued", "not_issued"]).optional(),
    /** `executed`: an effect happened. `blocked`: the attempt was refused or failed with no effect. */
    execution: z.enum(["executed", "blocked"]).optional(),
    /** Acceptable rejection / error codes when execution is blocked. */
    resultCodes: z.array(z.string().max(80)).max(10).optional(),
    control: z.array(controlSchema).min(1).optional(),
    /** For parallel executes: how many may succeed. */
    executedAtMost: z.number().int().min(0).max(20).optional(),
    executedExactly: z.number().int().min(0).max(20).optional(),
    /** The gateway must report the request as a replay of an earlier idempotent one. */
    replayed: z.boolean().optional(),
  })
  .strict();
export type ExpectedOutcome = z.infer<typeof expectedOutcomeSchema>;

export const attackStepSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
    kind: z.enum(["baseline", "attack", "control"]),
    action: z.enum(STEP_ACTIONS),
    label: z.string().min(3).max(300),
    /** Which agent's runtime key is used. `victim` is a second, unrelated sandbox tenant. */
    actor: z.enum(["primary", "other", "victim"]).default("primary"),
    /** Whose task is addressed. */
    target: z.enum(["own", "victim"]).default("own"),
    tool: z.string().max(100).optional(),
    operation: z.string().max(100).optional(),
    resource: z.string().max(200).optional(),
    arguments: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    maxUses: z.number().int().min(1).max(5).optional(),
    /** Name under which the issued capability is stored for later steps. */
    capture: z.string().max(40).optional(),
    /** Use a previously captured capability (execute / revoke_capability). */
    use: z.string().max(40).optional(),
    /** For `reauthorize`: the step id whose exact request (same idempotency key) is repeated. */
    ref: z.string().max(40).optional(),
    /** Present the capability with these overrides (over-broadening / substitution). */
    override: z
      .object({
        tool: z.string().optional(),
        operation: z.string().optional(),
        resource: z.string().optional(),
        arguments: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      })
      .strict()
      .optional(),
    parallel: z.number().int().min(1).max(20).optional(),
    /** Reuse the previous execution's idempotency key (replay). */
    sameKey: z.boolean().optional(),
    fault: z.string().max(40).optional(),
    faultParams: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    /** Apply this fault between the connector's reservation and its dispatch. */
    faultBeforeDispatch: z.string().max(40).optional(),
    registryVersionOverride: z.string().max(60).optional(),
    semantic: semanticScriptSchema.optional(),
    /** Narrative: where the malicious content came from. Shown in the UI; synthetic text only. */
    injected: z
      .object({
        source: z.enum(["user", "tool_response", "document", "adversary"]),
        text: z.string().max(1000),
      })
      .strict()
      .optional(),
    expect: expectedOutcomeSchema,
  })
  .strict();
export type AttackStep = z.infer<typeof attackStepSchema>;

export const boundaryRuleSchema = z
  .object({
    /** Human sentence: what must never happen. */
    description: z.string().max(300),
    tool: z.string().max(100),
    where: z
      .object({
        key: z.string().max(60),
        op: z.enum(["equals", "not_equals", "matches", "gt"]),
        value: z.union([z.string(), z.number()]),
      })
      .strict()
      .optional(),
  })
  .strict();
export type BoundaryRule = z.infer<typeof boundaryRuleSchema>;

export const planNodeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
    tool: z.string(),
    arguments: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    expectedSideEffect: z.enum(["read", "write_create", "write_update", "write_delete", "admin"]),
    maxInvocations: z.number().int().min(1).max(20).default(1),
  })
  .strict();

export const scenarioEnvironmentSchema = z
  .object({
    semantic: z
      .object({
        mode: z.enum(["off", "shadow", "enforce"]).default("enforce"),
        requiredClasses: z.array(z.enum(["low", "medium", "high"])).default([]),
        timeoutMs: z.number().int().min(100).max(5000).default(400),
      })
      .strict()
      .default({ mode: "enforce", requiredClasses: [], timeoutMs: 400 }),
    approvalClasses: z.array(z.enum(["low", "medium", "high"])).default([]),
    capabilityTtlSeconds: z.number().int().min(5).max(900).default(60),
    github: z
      .object({
        repos: z
          .array(
            z
              .object({
                owner: z.string(),
                name: z.string(),
                /** Synthetic issues (their bodies are how indirect injection reaches the agent). */
                issues: z
                  .array(
                    z
                      .object({
                        number: z.number().int().min(1).max(50),
                        title: z.string().max(200),
                        body: z.string().max(2000),
                      })
                      .strict(),
                  )
                  .max(5)
                  .default([]),
                /** Synthetic files on the default branch (fake secrets only). */
                files: z
                  .array(z.object({ path: z.string().max(200), content: z.string().max(2000) }).strict())
                  .max(5)
                  .default([]),
              })
              .strict(),
          )
          .min(1)
          .max(5),
        boundRepo: z.string(),
      })
      .strict()
      .optional(),
    /** Seed a second, unrelated tenant with its own task and contract. */
    victim: z.boolean().default(false),
    forbiddenResources: z.array(z.string()).default([]),
  })
  .strict();
export type ScenarioEnvironment = z.infer<typeof scenarioEnvironmentSchema>;

export const scenarioVariantSchema = z
  .object({
    label: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
    description: z.string().max(300),
    patch: configPatchSchema,
  })
  .strict();
export type ScenarioVariant = z.infer<typeof scenarioVariantSchema>;

export const scenarioSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    key: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/),
    version: z.number().int().min(1),
    title: z.string().min(3).max(140),
    description: z.string().max(1200),
    category: categorySchema,
    /** Severity of a failure of this scenario's attack steps. */
    severity: severitySchema,
    taxonomy: z.array(taxonomyRefSchema).max(6).default([]),
    /** The trusted user's task. */
    intent: z.string().min(5).max(500),
    /** Candidate plan; compiled into the active contract by the REAL validator, solver and compiler. */
    plan: z.array(planNodeSchema).min(1).max(12),
    environment: scenarioEnvironmentSchema.default({
      semantic: { mode: "enforce", requiredClasses: [], timeoutMs: 400 },
      approvalClasses: [],
      capabilityTtlSeconds: 60,
      victim: false,
      forbiddenResources: [],
    }),
    variants: z.array(scenarioVariantSchema).max(6).default([]),
    /** A regression scenario bakes the accepted remediation in: this patch applies to every run of it. */
    appliedPatch: configPatchSchema.optional(),
    steps: z.array(attackStepSchema).min(1).max(30),
    /** The side-effect boundary: effects that must never occur. */
    boundary: z.array(boundaryRuleSchema).max(10).default([]),
    successCriteria: z.string().max(500),
    tags: z.array(z.string().max(30)).max(8).default([]),
  })
  .strict();
export type Scenario = z.infer<typeof scenarioSchema>;
/** What an author writes: defaults (variants, boundary, tags…) may be omitted. */
export type ScenarioInput = z.input<typeof scenarioSchema>;

// ---------------------------------------------------------------------------
// Environment and campaign
// ---------------------------------------------------------------------------

export const environmentSpecSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    seedData: z.literal("synthetic-v1").default("synthetic-v1"),
    limits: z
      .object({
        maxScenarioSteps: z.number().int().min(1).max(60).default(40),
        maxScenarioMs: z.number().int().min(1000).max(120_000).default(45_000),
        maxCampaignMs: z.number().int().min(5000).max(900_000).default(300_000),
        maxRuns: z.number().int().min(1).max(500).default(120),
        /** Advisory cost ceiling: number of provider (semantic) calls. Mock provider costs nothing. */
        maxSemanticCalls: z.number().int().min(0).max(5000).default(2000),
      })
      .strict()
      .default({
        maxScenarioSteps: 40,
        maxScenarioMs: 45_000,
        maxCampaignMs: 300_000,
        maxRuns: 120,
        maxSemanticCalls: 2000,
      }),
    sandboxMinutes: z.number().int().min(2).max(60).default(15),
  })
  .strict();
export type EnvironmentSpec = z.infer<typeof environmentSpecSchema>;

export const campaignConfigSchema = z
  .object({
    scenarioKeys: z.array(z.string()).min(1).max(60),
    /** Variant labels to run for every scenario that defines them; `baseline` is always available. */
    variants: z.array(z.string()).min(1).max(6).default(["baseline"]),
    repetitions: z.number().int().min(1).max(5).default(1),
    /** Extra patch applied to every run (used by before/after remediation reruns). */
    patch: configPatchSchema.optional(),
  })
  .strict();
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface StepActual {
  finalDecision?: Decision | null;
  deterministicDecision?: Decision | null;
  reasonCodes: string[];
  capability: "issued" | "not_issued" | "n/a";
  execution: "executed" | "blocked" | "n/a";
  resultCode?: string | null;
  executedCount?: number;
  replayed?: boolean;
  status?: string;
  httpStatus?: number | null;
  approval?: string | null;
  semantic?: {
    state: string | null;
    risk: string | null;
    provider: string | null;
    indicators: string[];
    narrowed: boolean;
  } | null;
  guidance?: { nextStep: string; message: string } | null;
}

export interface StepResult {
  seq: number;
  stepKey: string;
  kind: "baseline" | "attack" | "fault" | "control";
  action: string;
  label: string;
  request: Record<string, unknown> | null;
  expected: ExpectedOutcome;
  actual: StepActual;
  verdict: "pass" | "fail" | "skipped" | "error";
  control: Control | null;
  mismatches: string[];
  latencyMs: number | null;
  occurredAt: string;
  evidence: Record<string, unknown> | null;
}

export interface EffectRecord {
  tool: string;
  stepKey: string;
  description: string;
  args: Record<string, string | number | boolean>;
  violates: string | null;
}

export interface RunMetrics {
  attackSteps: number;
  attackBlocked: number;
  attackAllowed: number;
  benignSteps: number;
  benignBlocked: number;
  unauthorizedEffects: number;
  disagreements: number;
  replayAttempts: number;
  replayBlocked: number;
  approvalBypassAttempts: number;
  approvalBypassBlocked: number;
  authorizeLatenciesMs: number[];
  timeToFirstBlockMs: number | null;
  unusedAuthority: { allowedTools: number; exercisedTools: number };
  controlsExercised: Control[];
}

export interface RunResult {
  scenarioKey: string;
  scenarioVersion: number;
  variant: string;
  repetition: number;
  seed: number;
  status: "completed" | "cancelled" | "error";
  verdict: "pass" | "fail" | "error";
  steps: StepResult[];
  effects: EffectRecord[];
  metrics: RunMetrics;
  errorCategory?: string;
  durationMs: number;
}

export const REMEDIATION_KINDS = [
  "add_argument_constraint",
  "narrow_resource_binding",
  "reduce_invocation_budget",
  "add_hard_deny",
  "require_human_approval",
  "enforce_semantic_review",
  "remove_unneeded_action",
  "shorten_capability_ttl",
  "rotate_credential",
  "update_tool_registry",
  "ask_user_clarification",
  "replan_with_allowed_operation",
  "add_regression_scenario",
] as const;
export type RemediationKind = (typeof REMEDIATION_KINDS)[number];

export const remediationProposalSchema = z
  .object({
    kind: z.enum(REMEDIATION_KINDS),
    title: z.string().max(200),
    rationale: z.string().max(1000),
    patch: configPatchSchema.nullable(),
    humanSteps: z.array(z.string().max(500)).max(8),
    agentGuidance: z.string().max(500).nullable(),
    broadensAuthority: z.literal(false),
    requiresHumanReview: z.literal(true),
  })
  .strict();

export interface RemediationProposal {
  kind: RemediationKind;
  title: string;
  rationale: string;
  /** Machine-applicable narrowing patch for the sandbox before/after rerun; null for guidance-only proposals. */
  patch: ConfigPatch | null;
  /** What a human would do in the product to apply it for real (never done automatically). */
  humanSteps: string[];
  /** For the agent: what to do next after this failure. */
  agentGuidance: string | null;
  /** Asserted false by the server; the database refuses anything else. */
  broadensAuthority: false;
  requiresHumanReview: true;
}

export interface FindingDraft {
  scenarioKey: string;
  runKey: string;
  stepSeq: number;
  severity: Severity;
  category: Category;
  cause: Cause;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  remediations: RemediationProposal[];
}
