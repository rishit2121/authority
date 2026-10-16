import { z } from "zod";

/**
 * Reviewer output contracts: a strict JSON schema sent to the model and the
 * zod schema its output must satisfy. Bounds that strict JSON schema cannot
 * express (score range, lengths) are enforced by zod; anything outside them is
 * "malformed", which is never treated as a pass.
 */

const score = z.number().min(0).max(1);
const shortText = (max: number) => z.string().max(max);

export const instructionsSchema = z.object({ instructions: z.array(shortText(1_000)).max(40) }).strict();
export const instructionsJsonSchema = {
  type: "object",
  properties: { instructions: { type: "array", items: { type: "string" } } },
  required: ["instructions"],
  additionalProperties: false,
};

export const scoreItemSchema = z
  .object({ user_task_instruction: shortText(1_000), contribute_to_score: score, reason: shortText(1_000) })
  .strict();
export const scoresSchema = z.object({ scores: z.array(scoreItemSchema).max(40) }).strict();
export const scoresJsonSchema = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          user_task_instruction: { type: "string" },
          contribute_to_score: { type: "number" },
          reason: { type: "string" },
        },
        required: ["user_task_instruction", "contribute_to_score", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["scores"],
  additionalProperties: false,
};

export const REQUIREMENT_KINDS = [
  "recipient",
  "channel",
  "account",
  "customer",
  "payment",
  "resource",
  "amount",
  "currency",
  "limit",
  "date",
  "condition",
  "other",
] as const;

export const objectivesSchema = z
  .object({
    task_instructions: z.array(shortText(1_000)).min(1).max(20),
    prohibitions: z.array(shortText(500)).max(20),
    requirements: z
      .array(
        z.object({ kind: z.enum(REQUIREMENT_KINDS), value: shortText(300), text: shortText(500) }).strict(),
      )
      .max(40),
    quoted_material: z.array(shortText(200)).max(10),
  })
  .strict();
export type ObjectivesOutput = z.infer<typeof objectivesSchema>;
export const objectivesJsonSchema = {
  type: "object",
  properties: {
    task_instructions: { type: "array", items: { type: "string" } },
    prohibitions: { type: "array", items: { type: "string" } },
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...REQUIREMENT_KINDS] },
          value: { type: "string" },
          text: { type: "string" },
        },
        required: ["kind", "value", "text"],
        additionalProperties: false,
      },
    },
    quoted_material: { type: "array", items: { type: "string" } },
  },
  required: ["task_instructions", "prohibitions", "requirements", "quoted_material"],
  additionalProperties: false,
};

export const FINDING_TYPES = [
  "wrong_recipient",
  "wrong_channel",
  "wrong_resource",
  "wrong_amount",
  "wrong_currency",
  "unrequested_side_effect",
  "extra_operation",
  "contradicted_prohibition",
  "unresolved_value",
  "missing_outcome",
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

const stepScoresJson = {
  type: "array",
  items: {
    type: "object",
    properties: { user_task_instruction: { type: "string" }, contribute_to_score: { type: "number" } },
    required: ["user_task_instruction", "contribute_to_score"],
    additionalProperties: false,
  },
};
const stepScores = z
  .array(z.object({ user_task_instruction: shortText(1_000), contribute_to_score: score }).strict())
  .max(20);

export const planReviewSchema = z
  .object({
    steps: z.array(z.object({ step_id: shortText(100), scores: stepScores }).strict()).max(30),
    findings: z
      .array(
        z
          .object({
            type: z.enum(FINDING_TYPES),
            step_id: shortText(100).nullable(),
            field: shortText(100).nullable(),
            severity: z.enum(["conflict", "ambiguous"]),
            explanation: shortText(400),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type PlanReviewOutput = z.infer<typeof planReviewSchema>;
export const planReviewJsonSchema = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { step_id: { type: "string" }, scores: stepScoresJson },
        required: ["step_id", "scores"],
        additionalProperties: false,
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...FINDING_TYPES] },
          step_id: { type: ["string", "null"] },
          field: { type: ["string", "null"] },
          severity: { type: "string", enum: ["conflict", "ambiguous"] },
          explanation: { type: "string" },
        },
        required: ["type", "step_id", "field", "severity", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps", "findings"],
  additionalProperties: false,
};

export const contentScreenSchema = z
  .object({
    instructions: z
      .array(
        z
          .object({
            text: shortText(1_000),
            addressed_to_agent: z.boolean(),
            scores: stepScores,
            contradicts_prohibition: z.boolean(),
            uncertain: z.boolean(),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();
export type ContentScreenOutput = z.infer<typeof contentScreenSchema>;
export const contentScreenJsonSchema = {
  type: "object",
  properties: {
    instructions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          addressed_to_agent: { type: "boolean" },
          scores: stepScoresJson,
          contradicts_prohibition: { type: "boolean" },
          uncertain: { type: "boolean" },
        },
        required: ["text", "addressed_to_agent", "scores", "contradicts_prohibition", "uncertain"],
        additionalProperties: false,
      },
    },
  },
  required: ["instructions"],
  additionalProperties: false,
};
