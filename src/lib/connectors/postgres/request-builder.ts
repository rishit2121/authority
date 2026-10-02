import "server-only";

import { sanitizeResource } from "@/lib/gateway/argument-audit";

import { PostgresQueryValidationError, type PostgresQueryDefinitionRow } from "./types";

/**
 * Turns a published query's own `sql_template` (named placeholders, e.g.
 * ":customerId") plus the agent's schema-validated arguments into one native
 * parameterized query -- `$1, $2, ...` with a positional value array, the
 * exact mechanism `pg` uses to bind values without ever interpolating them
 * into the SQL text. No value is ever concatenated into the statement
 * string, by construction, the same guarantee
 * ../custom-api/request-builder.ts gives path/query/body values for HTTP.
 */

export interface BuiltQuery {
  sql: string;
  values: Array<string | number | boolean>;
  /** The identifying value for the one field marked identifiesResource — what a capability's resource/constraints bind against. */
  resource: string;
}

/** A ":name" not immediately preceded by another ":" -- excludes Postgres's own "::type" cast operator. */
const NAMED_PARAM = /(?<!:):([a-zA-Z][a-zA-Z0-9_]*)/g;

/** Validates args against the query's declared fields. Throws on the first violation; never coerces silently. */
export function validateArguments(
  definition: Pick<PostgresQueryDefinitionRow, "inputSchema">,
  args: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const validated: Record<string, string | number | boolean> = {};
  const declaredKeys = new Set(definition.inputSchema.fields.map((f) => f.key));
  for (const key of Object.keys(args)) {
    if (!declaredKeys.has(key)) {
      throw new PostgresQueryValidationError("ARGUMENT_UNDECLARED", `"${key}" is not a declared argument.`);
    }
  }
  for (const field of definition.inputSchema.fields) {
    const value = args[field.key];
    if (value === undefined || value === null) {
      if (field.required) {
        throw new PostgresQueryValidationError("ARGUMENT_MISSING", `"${field.key}" is required.`);
      }
      continue;
    }
    if (field.type === "string" && typeof value !== "string") {
      throw new PostgresQueryValidationError("ARGUMENT_INVALID", `"${field.key}" must be a string.`);
    }
    if (field.type === "number" && typeof value !== "number") {
      throw new PostgresQueryValidationError("ARGUMENT_INVALID", `"${field.key}" must be a number.`);
    }
    if (field.type === "boolean" && typeof value !== "boolean") {
      throw new PostgresQueryValidationError("ARGUMENT_INVALID", `"${field.key}" must be a boolean.`);
    }
    validated[field.key] = value as string | number | boolean;
  }
  return validated;
}

export function buildQuery(
  definition: Pick<PostgresQueryDefinitionRow, "sqlTemplate" | "inputSchema">,
  args: Record<string, unknown>,
): BuiltQuery {
  const validated = validateArguments(definition, args);

  let resource: string | null = null;
  for (const field of definition.inputSchema.fields) {
    if (field.identifiesResource) {
      const value = validated[field.key];
      if (value === undefined) {
        throw new PostgresQueryValidationError("ARGUMENT_MISSING", `"${field.key}" is required.`);
      }
      resource = String(value);
      break;
    }
  }
  if (resource === null) {
    throw new PostgresQueryValidationError(
      "QUERY_MISCONFIGURED",
      "No field is marked identifiesResource; this query cannot bind a capability resource.",
    );
  }

  const values: Array<string | number | boolean> = [];
  const positionOf = new Map<string, number>();
  const unresolved: string[] = [];
  const sql = definition.sqlTemplate.replace(NAMED_PARAM, (_match, key: string) => {
    const value = validated[key];
    if (value === undefined) {
      unresolved.push(key);
      return _match;
    }
    let position = positionOf.get(key);
    if (position === undefined) {
      values.push(value);
      position = values.length;
      positionOf.set(key, position);
    }
    return `$${position}`;
  });
  if (unresolved.length > 0) {
    throw new PostgresQueryValidationError(
      "ARGUMENT_MISSING",
      `Parameter(s) not supplied: ${unresolved.join(", ")}.`,
    );
  }

  // Query result rows and resource identifiers can be arbitrary tenant data
  // (an email, a name with spaces) unlike Stripe/Slack's known-safe id
  // formats -- sanitizeResource applies the same redaction the gateway
  // itself applies at authorize/execute time (see
  // ../gmail/connector.ts's own comment on this exact requirement), so this
  // connector's notion of "resource" always matches what a capability was
  // actually bound against.
  return { sql, values, resource: sanitizeResource(resource) ?? resource };
}
