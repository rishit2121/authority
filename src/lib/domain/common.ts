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

/**
 * Tenant membership role. Mirrors the database's `tenant_role` enum exactly
 * (see `authz.role_rank()`) — kept here, not derived from generated
 * Supabase types, because domain modules must not import anything
 * persistence-specific (see `lib/domain`'s module boundary). A mismatch
 * between this and the database enum would surface immediately: every
 * mapper round-trip test parses real rows through this schema.
 */
export const tenantRoleSchema = z.enum(["viewer", "developer", "security_admin", "admin", "owner"]);
export type TenantRole = z.infer<typeof tenantRoleSchema>;

/** Rank order matching `authz.role_rank()` — never used to *authorize* anything client-side, only to describe requirements and order UI. */
export const TENANT_ROLE_RANK: Record<TenantRole, number> = {
  viewer: 10,
  developer: 20,
  security_admin: 30,
  admin: 40,
  owner: 50,
};

export type Id = z.infer<typeof idSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type ToolArguments = z.infer<typeof toolArgumentsSchema>;
