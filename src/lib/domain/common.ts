import { z } from "zod";

/**
 * Shared primitives. Every entity uses these so identifier and timestamp
 * handling stays consistent across the domain.
 */

/** Opaque identifier. Prefixed strings (`task_1842`) rather than raw UUIDs. */
export const idSchema = z.string().min(1).max(128);

/**
 * ISO-8601 instant, always serialized as a string so payloads stay portable.
 *
 * `offset: true` is required, not cosmetic: PostgREST — what every Supabase
 * repository in `lib/persistence/` actually reads from — serializes a
 * `timestamptz` as `2026-09-22T19:04:24.514823+00:00`, a numeric offset, not
 * a literal `Z`. Zod's default `z.iso.datetime()` accepts only `Z` and
 * rejects every real timestamp this domain will ever receive from the
 * database; this was caught by the integration suite in
 * `src/tests/integration/`, which runs mappers against the real linked
 * project rather than only hand-written `Z`-suffixed fixtures. `Z` remains
 * accepted too, so existing fixtures and mock data are unaffected.
 */
export const timestampSchema = z.iso.datetime({ offset: true });

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
