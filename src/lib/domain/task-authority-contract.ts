import { z } from "zod";

import { idSchema, tenantRoleSchema, timestampSchema, toolNameSchema } from "./common";

/**
 * A constraint narrowing one allowed action to specific resources.
 * `equals` pins an exact value; `matches` is a glob for families like `fix-*`.
 */
export const resourceConstraintSchema = z
  .object({
    key: z.string().min(1),
    equals: z.string().optional(),
    matches: z.string().optional(),
  })
  .strict()
  .refine((c) => Boolean(c.equals) !== Boolean(c.matches), {
    message: "resource constraint needs exactly one of `equals` or `matches`",
  });

export const allowedActionSchema = z
  .object({
    tool: toolNameSchema,
    constraints: z.array(resourceConstraintSchema).default([]),
    /** Cap on how many times this specific action may run under the contract. */
    maxInvocations: z.number().int().positive().optional(),
  })
  .strict();

export const ephemeralLimitsSchema = z
  .object({
    maxToolInvocations: z.number().int().positive(),
    expiresInSeconds: z.number().int().positive(),
  })
  .strict();

/**
 * Lifecycle status. Added in Part 3A: the original design assumed "the
 * domain contract *is* the active authority boundary at the instant it's
 * read," which held while `active` was the only status any client-facing
 * code ever produced. Part 3A's compiler can now propose a contract that
 * sits in `proposed`/`awaiting_approval`/`rejected` for a real, visible
 * stretch of time, so the UI needs to know and honestly display which one
 * it's looking at — this is no longer database-only bookkeeping.
 */
export const contractStatusSchema = z.enum([
  "draft",
  "proposed",
  "awaiting_approval",
  "rejected",
  "active",
  "expired",
  "revoked",
  "superseded",
]);

/**
 * One activation-time human-approval requirement — the domain shape of
 * `lib/authorization/approval-rules.ts`'s deriver output, persisted
 * verbatim on the contract that produced it (frozen by the database's
 * immutability trigger, exactly like `allowedActions`). Lives in the domain
 * layer, not in `lib/authorization` (server-only), because a persisted
 * contract's own shape needs to carry it and domain types must stay
 * importable from anywhere, including client components that only display
 * it.
 */
export const approvalRequirementSchema = z
  .object({
    kind: z.enum(["task_owner", "role"]),
    /** Present only when `kind === "role"`. */
    role: tenantRoleSchema.optional(),
    count: z.number().int().positive(),
    selfApprovalAllowed: z.boolean(),
    reasons: z.array(z.string()),
  })
  .strict();

/**
 * The maximum authority a task may ever receive — derived from trusted user
 * intent *before* the agent proposes anything. Nothing downstream may widen
 * it: the evaluator and the semantic provider can only ever narrow.
 */
export const taskAuthorityContractSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    taskId: idSchema,
    /** Absent only for pre-Part-3A demo-installer rows, which carry no plan/registry/compiler provenance at all. */
    planId: idSchema.optional(),
    version: z.number().int().positive(),
    specVersion: z.string().min(1),
    status: contractStatusSchema,
    /** Pinned at proposal time; activation refuses to proceed unless these are still ones the caller currently supports. */
    registryVersion: z.string().min(1).optional(),
    compilerVersion: z.string().min(1).optional(),
    inputHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    outputHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    allowedActions: z.array(allowedActionSchema).min(1),
    /** Hard denials. These outrank every allow and every semantic signal. */
    forbiddenResources: z.array(z.string().min(1)).default([]),
    /** Exact tool identifiers denied outright by an active policy — distinct from the glob-based forbiddenResources above. */
    forbiddenOperations: z.array(toolNameSchema).default([]),
    ephemeralLimits: ephemeralLimitsSchema,
    /** What this exact contract version required for activation — set once at proposal time, never recomputed in place. */
    requiredApprovalsSpec: z.array(approvalRequirementSchema).default([]),
    rejectionReason: z.string().optional(),
    activatedAt: timestampSchema.optional(),
    /** Absolute; set once at activation from `ephemeralLimits.expiresInSeconds`. See contract-runtime.ts's isContractCurrentlyActive(). */
    expiresAt: timestampSchema.optional(),
    revokedAt: timestampSchema.optional(),
    revocationReason: z.string().optional(),
    supersededAt: timestampSchema.optional(),
    supersededByContractId: idSchema.optional(),
    createdAt: timestampSchema,
  })
  .strict();

export type ResourceConstraint = z.infer<typeof resourceConstraintSchema>;
export type AllowedAction = z.infer<typeof allowedActionSchema>;
export type EphemeralLimits = z.infer<typeof ephemeralLimitsSchema>;
export type ContractStatus = z.infer<typeof contractStatusSchema>;
export type ApprovalRequirement = z.infer<typeof approvalRequirementSchema>;
export type ApprovalRequirementKind = ApprovalRequirement["kind"];
export type TaskAuthorityContract = z.infer<typeof taskAuthorityContractSchema>;
