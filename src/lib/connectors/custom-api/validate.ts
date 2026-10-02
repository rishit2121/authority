import "server-only";

import {
  FORBIDDEN_HEADER_NAMES,
  type CustomOperationField,
  type CustomOperationInputSchema,
  type CustomOperationRequestMapping,
} from "./types";

/**
 * Authoring-time structural validation for a custom operation definition --
 * the TypeScript side of the two-layer check `gateway.validate_custom_operation`
 * (20261001000005_custom_operations.sql) describes in its own comment. The
 * database re-checks only the cheap, load-bearing structural facts (a path
 * placeholder or a field exists; no `..`/`//`); everything that requires
 * actually walking the field list and the path template together -- so a
 * developer sees a specific, actionable error instead of a generic "invalid"
 * -- lives here, run before the RPC is even called.
 *
 * See docs/connectors/CUSTOM_API.md for the schema this subset supports and
 * why each rule exists.
 */

export interface OperationValidationIssue {
  field: string;
  message: string;
}

export interface OperationValidationResult {
  ok: boolean;
  issues: OperationValidationIssue[];
}

const MAX_FIELDS = 20;
const PATH_PARAM = /\{([a-zA-Z0-9_]+)\}/g;
const KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/;

function placeholdersIn(pathTemplate: string): Set<string> {
  const names = new Set<string>();
  for (const match of pathTemplate.matchAll(PATH_PARAM)) names.add(match[1]);
  return names;
}

export function validateOperationDefinition(input: {
  pathTemplate: string;
  inputSchema: CustomOperationInputSchema;
  requestMapping: CustomOperationRequestMapping;
}): OperationValidationResult {
  const issues: OperationValidationIssue[] = [];
  const { pathTemplate, inputSchema, requestMapping } = input;

  if (!pathTemplate.startsWith("/")) {
    issues.push({ field: "pathTemplate", message: 'Path template must start with "/".' });
  }
  if (pathTemplate.includes("..") || pathTemplate.includes("//")) {
    issues.push({ field: "pathTemplate", message: 'Path template may not contain ".." or "//".' });
  }

  const fields = inputSchema.fields;
  if (fields.length === 0) {
    issues.push({ field: "inputSchema.fields", message: "At least one field is required." });
  }
  if (fields.length > MAX_FIELDS) {
    issues.push({ field: "inputSchema.fields", message: `At most ${MAX_FIELDS} fields are supported.` });
  }

  const seenKeys = new Set<string>();
  const pathFieldKeys = new Set<string>();
  let identifiesResourceCount = 0;
  for (const field of fields) {
    validateOneField(field, seenKeys, issues);
    if (field.in === "path") pathFieldKeys.add(field.key);
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

  // Every path placeholder needs a declared, path-located field, and vice
  // versa -- an undeclared placeholder can never be filled in, and a
  // path-located field that names no placeholder can never be used.
  const placeholders = placeholdersIn(pathTemplate);
  for (const name of placeholders) {
    if (!pathFieldKeys.has(name)) {
      issues.push({ field: "pathTemplate", message: `"{${name}}" has no matching path field declared.` });
    }
  }
  for (const key of pathFieldKeys) {
    if (!placeholders.has(key)) {
      issues.push({
        field: "inputSchema.fields",
        message: `Field "${key}" is declared "in": "path" but does not appear in the path template.`,
      });
    }
  }

  for (const header of requestMapping.staticHeaders ?? []) {
    if (FORBIDDEN_HEADER_NAMES.has(header.name.toLowerCase())) {
      issues.push({
        field: "requestMapping.staticHeaders",
        message: `"${header.name}" cannot be set by a static header.`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

function validateOneField(
  field: CustomOperationField,
  seenKeys: Set<string>,
  issues: OperationValidationIssue[],
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
  if (!["path", "query", "body"].includes(field.in)) {
    issues.push({
      field: `inputSchema.fields.${field.key}`,
      message: `Unsupported location "${field.in as string}".`,
    });
  }
  if (field.in === "path" && !field.required) {
    issues.push({
      field: `inputSchema.fields.${field.key}`,
      message: "A path field must be required -- an optional path segment is not supported.",
    });
  }
}
