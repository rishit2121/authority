import { z } from "zod";

/**
 * Shared primitives. Every entity uses these so identifier and timestamp
 * handling stays consistent across the domain.
 */

/** Opaque identifier. Prefixed strings (`task_1842`) rather than raw UUIDs. */
export const idSchema = z.string().min(1).max(128);

/** ISO-8601 instant, always serialized as a string so payloads stay portable. */
export const timestampSchema = z.iso.datetime();

/** Dotted `provider.action` tool name, e.g. `github.create_branch`. */
export const toolNameSchema = z
  .string()
  .regex(/^[a-z0-9_]+\.[a-z0-9_]+$/, "tool must be provider-qualified, e.g. github.create_branch");

/**
 * Arguments accompanying a tool call. Deliberately a shallow record of
 * primitives: anything an argument can express must be inspectable by policy,
 * and arbitrary nesting would defeat deterministic evaluation.
 */
export const toolArgumentsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
);

export type Id = z.infer<typeof idSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type ToolArguments = z.infer<typeof toolArgumentsSchema>;
