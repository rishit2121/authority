import "server-only";

import type { PostgresQueryEffect, PostgresQueryField, PostgresQueryInputSchema } from "./types";

/**
 * Authoring-time structural validation for a postgres query definition --
 * the TypeScript side of the two-layer check `gateway.validate_postgres_query`
 * (20261001000013_postgres_query_definitions.sql) describes in its own
 * comment, mirroring the same division of labor as
 * ../custom-api/validate.ts: the database re-checks the same facts
 * independently rather than trusting this ran correctly, but a developer
 * sees a specific, actionable error from here first.
 */

export interface QueryValidationIssue {
  field: string;
  message: string;
}

export interface QueryValidationResult {
  ok: boolean;
  issues: QueryValidationIssue[];
}

const MAX_FIELDS = 20;
const KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/;
/** A ":name" not immediately preceded by another ":" -- excludes Postgres's own "::type" cast operator. */
const NAMED_PARAM = /(?<!:):([a-zA-Z][a-zA-Z0-9_]*)/g;
const READ_FORBIDDEN =
  /\b(insert|update|delete|merge|drop|alter|truncate|grant|revoke|create|copy|vacuum|execute|call|do|listen|notify|refresh|reindex|cluster|comment|security)\b/i;
const ALWAYS_FORBIDDEN = /\b(drop|alter|truncate|grant|revoke|create|vacuum|reindex|cluster)\b/i;

function placeholdersIn(sqlTemplate: string): Set<string> {
  const names = new Set<string>();
  for (const match of sqlTemplate.matchAll(NAMED_PARAM)) names.add(match[1]);
  return names;
}

export function validateQueryDefinition(input: {
  sqlTemplate: string;
  effect: PostgresQueryEffect;
  inputSchema: PostgresQueryInputSchema;
}): QueryValidationResult {
  const issues: QueryValidationIssue[] = [];
  const { sqlTemplate, effect, inputSchema } = input;
  const trimmed = sqlTemplate.trim();

  // Exactly one statement: a bare semicolon anywhere but a single optional
  // trailing one means statement stacking, never a legitimate single query.
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    issues.push({ field: "sqlTemplate", message: 'Only one statement is supported; remove the extra ";".' });
  }

  // Only a declared read is required to start with SELECT/WITH -- a write
  // legitimately starts with INSERT/UPDATE/DELETE/MERGE.
  if (effect === "read" && !/^(select|with)\b/i.test(trimmed)) {
    issues.push({ field: "sqlTemplate", message: 'A read query must start with "SELECT" or "WITH".' });
  }

  // A nominal SELECT can still write via a data-modifying CTE ("WITH x AS
  // (DELETE FROM ... RETURNING *) SELECT * FROM x") -- the first-token check
  // above cannot catch this, so a declared read is independently scanned for
  // any DML/DDL keyword anywhere in the statement, not just its head.
  if (effect === "read" && READ_FORBIDDEN.test(sqlTemplate)) {
    issues.push({
      field: "sqlTemplate",
      message:
        "A read query may not contain a data-modifying or schema-changing keyword anywhere, including inside a CTE.",
    });
  }
  // Even a declared write may never be a schema/permissions change --
  // those belong to a real migration, not an agent-callable query.
  if (ALWAYS_FORBIDDEN.test(sqlTemplate)) {
    issues.push({
      field: "sqlTemplate",
      message:
        "Schema and permissions statements (DROP/ALTER/TRUNCATE/GRANT/REVOKE/CREATE/VACUUM/REINDEX/CLUSTER) are never allowed.",
    });
  }

  const fields = inputSchema.fields;
  if (fields.length === 0) {
    issues.push({ field: "inputSchema.fields", message: "At least one field is required." });
  }
  if (fields.length > MAX_FIELDS) {
    issues.push({ field: "inputSchema.fields", message: `At most ${MAX_FIELDS} fields are supported.` });
  }

  const seenKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  let identifiesResourceCount = 0;
  for (const field of fields) {
    validateOneField(field, seenKeys, issues);
    fieldKeys.add(field.key);
    if (field.identifiesResource) identifiesResourceCount += 1;
  }
  if (identifiesResourceCount === 0) {
    issues.push({
      field: "inputSchema.fields",
      message: "Exactly one field must be marked as identifying the resource.",
    });
  } else if (identifiesResourceCount > 1) {
    issues.push({
      field: "inputSchema.fields",
      message: "Only one field may be marked as identifying the resource.",
    });
  }

  // Every named placeholder needs a declared field, and vice versa -- an
  // undeclared placeholder can never be bound, and a declared field that
  // names no placeholder can never be used.
  const placeholders = placeholdersIn(sqlTemplate);
  for (const name of placeholders) {
    if (!fieldKeys.has(name)) {
      issues.push({ field: "sqlTemplate", message: `":${name}" has no matching field declared.` });
    }
  }
  for (const key of fieldKeys) {
    if (!placeholders.has(key)) {
      issues.push({
        field: "inputSchema.fields",
        message: `Field "${key}" is declared but does not appear as ":${key}" in the statement.`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

function validateOneField(
  field: PostgresQueryField,
  seenKeys: Set<string>,
  issues: QueryValidationIssue[],
): void {
  if (!KEY_PATTERN.test(field.key)) {
    issues.push({
      field: `inputSchema.fields.${field.key}`,
      message: `"${field.key}" must start with a letter or underscore and contain only letters, digits, and underscores.`,
    });
  }
  if (seenKeys.has(field.key)) {
    issues.push({ field: `inputSchema.fields.${field.key}`, message: `Duplicate field key "${field.key}".` });
  }
  seenKeys.add(field.key);
  if (!["string", "number", "boolean"].includes(field.type)) {
    issues.push({
      field: `inputSchema.fields.${field.key}`,
      message: `Unsupported type "${field.type as string}".`,
    });
  }
  // Every declared field must appear as a ":key" placeholder somewhere in
  // the statement (enforced above), and a native parameterized query has no
  // way to "skip" a placeholder that is present -- unlike Custom API, where
  // an optional query-string field can simply be left out of the URL.
  // "required: false" would therefore silently pass authoring-time checks
  // but always fail at execution with ARGUMENT_MISSING the moment the field
  // is omitted, so it is rejected here instead.
  if (!field.required) {
    issues.push({
      field: `inputSchema.fields.${field.key}`,
      message: `"${field.key}" must be required -- an optional Postgres query parameter is not supported.`,
    });
  }
}
