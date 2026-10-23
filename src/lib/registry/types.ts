import "server-only";

import { z } from "zod";

import { toolNameSchema } from "@/lib/domain/common";

/**
 * The trusted tool/permission registry's own types.
 *
 * This is audited, version-controlled code, not client-writable data. There
 * is no database table backing it and no server action ever accepts registry
 * content from a caller — a registry that any tenant could influence would
 * contradict "trusted." Everything here is `server-only`: none of it is a
 * Server/Client Component prop, and none of it is ever sent to the browser.
 */

/** Closed vocabulary. A tool's effect is registry metadata, never inferred. */
export const sideEffectSchema = z.enum(["read", "write_create", "write_update", "write_delete", "admin"]);
export type SideEffect = z.infer<typeof sideEffectSchema>;

export const dataSensitivitySchema = z.enum(["public", "internal", "confidential", "secret"]);
export type DataSensitivity = z.infer<typeof dataSensitivitySchema>;

export const permissionClassificationSchema = z.enum(["read", "write", "admin"]);
export type PermissionClassification = z.infer<typeof permissionClassificationSchema>;

/**
 * A small, closed argument-schema descriptor language — deliberately not
 * arbitrary JSON Schema or a live Zod instance, so the registry stays pure
 * data (auditable by reading it) rather than executable validation logic
 * smuggled into what is supposed to be a fixture.
 */
export const argumentFieldSchema = z
  .object({
    key: z.string().min(1).max(100),
    type: z.enum(["string", "number", "boolean", "stringArray"]),
    required: z.boolean(),
    /** True when this field's value identifies the operation's resource. */
    identifiesResource: z.boolean().default(false),
    /**
     * True only for generated content (a message body, a subject, a title): the one kind of field a plan may fill
     * from an earlier step's output (`dataFlowRefs`). Authority does not verify where such a value came from and
     * does not constrain it at runtime. Every other field -- a recipient, channel, id, path, branch or amount --
     * must be a concrete value in the plan, which the compiler pins; a data-flow reference to it is refused.
     * Absent means false (only an explicit `true` counts), so a field nobody classified fails closed.
     */
    freeText: z.boolean().optional(),
  })
  .strict();
export type ArgumentField = z.infer<typeof argumentFieldSchema>;

export const toolOperationSchema = z
  .object({
    id: toolNameSchema,
    provider: z.string().min(1).max(100),
    sideEffect: sideEffectSchema,
    resourceType: z.string().min(1).max(100),
    dataSensitivity: dataSensitivitySchema,
    requiresApproval: z.boolean(),
    /**
     * True when this operation, by its registered nature, sends data outside
     * the organization (e.g. an email or webhook send) — never inferred from
     * the tool name. The plan validator has no deterministic way to confirm
     * a human intended a specific external disclosure, so every operation
     * marked true here always produces `requires_review`, unconditionally
     * (see plan-validator.ts) — there is no field anywhere that "explains
     * away" this flag.
     */
    externalCommunication: z.boolean(),
    /**
     * True when this operation moves money or commits the organization to a
     * financial obligation (a refund, a payment, a payout) — registry
     * metadata, never inferred from the tool name or arguments. Part 3B's
     * approval-rule deriver always escalates a financial operation to
     * require at least one approval, unconditionally.
     */
    financialImpact: z.boolean(),
    argumentFields: z.array(argumentFieldSchema).max(20),
    /**
     * Trusted, short, human-readable facts about this operation — registry-authored, never inferred and never
     * agent-supplied. Given to Jev (see `lib/jev`) as the operation's authoritative description; an agent's own
     * justification for calling this tool is never substituted for these.
     */
    preconditions: z.array(z.string().min(1).max(300)).max(10).default([]),
    effects: z.array(z.string().min(1).max(300)).max(10).default([]),
    /**
     * Other registry operation IDs a solver/reviewer could consider as a less-privileged substitute for this one
     * (e.g. a read-only operation instead of a write). Registry-curated; Jev may only ever choose from this exact
     * list when naming an alternative, never invent one (see `ToolNecessityEvaluation.alternativeOperationIds`).
     */
    alternativeOperationIds: z.array(toolNameSchema).max(10).default([]),
  })
  .strict();
export type ToolOperation = z.infer<typeof toolOperationSchema>;

export const permissionSchema = z
  .object({
    id: z.string().min(1).max(200),
    provider: z.string().min(1).max(100),
    /** Exact operation IDs this permission authorizes. Mechanical, not inferred from the name. */
    operations: z.array(toolNameSchema).min(1).max(100),
    classification: permissionClassificationSchema,
    /** Deterministic integer risk score. No floats in any security-relevant comparison. */
    riskCost: z.number().int().nonnegative().max(1000),
    /** Deterministic integer breadth score — how much this permission covers beyond one exact resource. */
    resourceBreadth: z.number().int().nonnegative().max(1000),
    allowsExternalCommunication: z.boolean(),
  })
  .strict();
export type Permission = z.infer<typeof permissionSchema>;

export const registrySchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Identifies this exact pinned registry content, recorded on every compilation. */
    registryVersion: z.string().min(1).max(40),
    operations: z.array(toolOperationSchema).min(1),
    permissions: z.array(permissionSchema).min(1),
  })
  .strict();
export type RegistryData = z.infer<typeof registrySchema>;
