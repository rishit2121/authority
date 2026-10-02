import "server-only";

import {
  CustomOperationValidationError,
  FORBIDDEN_HEADER_NAMES,
  type CustomOperationDefinitionRow,
} from "./types";

/**
 * The constrained declarative request builder: turns a custom operation's
 * own definition plus the agent's schema-validated arguments into one exact
 * HTTP request. There is no code execution path here at all — no
 * JavaScript, no shell, no template language beyond literal path-segment
 * substitution — by construction, not by a sandbox around something more
 * powerful.
 */

export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  /** The identifying value for the one field marked identifiesResource — what a capability's resource/constraints bind against. */
  resource: string;
}

const PATH_PARAM = /\{([a-zA-Z0-9_]+)\}/g;

function assertSafePathSegment(value: string, key: string): void {
  if (value.length === 0 || value.length > 500) {
    throw new CustomOperationValidationError("ARGUMENT_INVALID", `"${key}" must be 1-500 characters.`);
  }
  // Reject traversal and encoded separators outright -- a path parameter is
  // exactly one segment, never a sub-path, never an escape from one.
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new CustomOperationValidationError("PATH_TRAVERSAL", `"${key}" may not contain a path separator.`);
  }
  if (/%2f|%5c|%2e%2e/i.test(value)) {
    throw new CustomOperationValidationError(
      "PATH_TRAVERSAL",
      `"${key}" may not contain an encoded separator.`,
    );
  }
}

/** Validates args against the operation's declared fields. Throws on the first violation; never coerces silently. */
export function validateArguments(
  definition: Pick<CustomOperationDefinitionRow, "inputSchema">,
  args: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const validated: Record<string, string | number | boolean> = {};
  const declaredKeys = new Set(definition.inputSchema.fields.map((f) => f.key));
  for (const key of Object.keys(args)) {
    if (!declaredKeys.has(key)) {
      throw new CustomOperationValidationError("ARGUMENT_UNDECLARED", `"${key}" is not a declared argument.`);
    }
  }
  for (const field of definition.inputSchema.fields) {
    const value = args[field.key];
    if (value === undefined || value === null) {
      if (field.required) {
        throw new CustomOperationValidationError("ARGUMENT_MISSING", `"${field.key}" is required.`);
      }
      continue;
    }
    if (field.type === "string" && typeof value !== "string") {
      throw new CustomOperationValidationError("ARGUMENT_INVALID", `"${field.key}" must be a string.`);
    }
    if (field.type === "number" && typeof value !== "number") {
      throw new CustomOperationValidationError("ARGUMENT_INVALID", `"${field.key}" must be a number.`);
    }
    if (field.type === "boolean" && typeof value !== "boolean") {
      throw new CustomOperationValidationError("ARGUMENT_INVALID", `"${field.key}" must be a boolean.`);
    }
    validated[field.key] = value as string | number | boolean;
  }
  return validated;
}

export function buildRequest(
  definition: Pick<
    CustomOperationDefinitionRow,
    "pathTemplate" | "method" | "inputSchema" | "requestMapping" | "connectionId"
  > & { baseUrl: string },
  args: Record<string, unknown>,
): BuiltRequest {
  const validated = validateArguments(definition, args);

  let resource: string | null = null;
  const pathValues = new Map<string, string>();
  const queryEntries: Array<[string, string]> = [];
  const bodyFields: Record<string, string | number | boolean> = {};

  for (const field of definition.inputSchema.fields) {
    const value = validated[field.key];
    if (value === undefined) continue;
    if (field.identifiesResource) {
      if (resource !== null) {
        throw new CustomOperationValidationError(
          "OPERATION_MISCONFIGURED",
          "More than one field is marked identifiesResource; this operation cannot bind a single capability resource.",
        );
      }
      resource = String(value);
    }
    if (field.in === "path") {
      const asString = String(value);
      assertSafePathSegment(asString, field.key);
      pathValues.set(field.key, asString);
    } else if (field.in === "query") {
      queryEntries.push([field.key, String(value)]);
    } else {
      bodyFields[field.key] = value;
    }
  }

  const unresolvedPlaceholders: string[] = [];
  const path = definition.pathTemplate.replace(PATH_PARAM, (_match, key: string) => {
    const value = pathValues.get(key);
    if (value === undefined) {
      unresolvedPlaceholders.push(key);
      return "";
    }
    return encodeURIComponent(value);
  });
  if (unresolvedPlaceholders.length > 0) {
    throw new CustomOperationValidationError(
      "ARGUMENT_MISSING",
      `Path parameter(s) not supplied: ${unresolvedPlaceholders.join(", ")}.`,
    );
  }
  if (resource === null) {
    throw new CustomOperationValidationError(
      "OPERATION_MISCONFIGURED",
      "No field is marked identifiesResource; this operation cannot bind a capability resource.",
    );
  }

  const url = new URL(path, definition.baseUrl);
  for (const { name, value } of definition.requestMapping.staticQuery ?? []) {
    url.searchParams.set(name, value);
  }
  for (const [name, value] of queryEntries) {
    url.searchParams.set(name, value);
  }

  const headers: Record<string, string> = {};
  for (const { name, value } of definition.requestMapping.staticHeaders ?? []) {
    const lower = name.toLowerCase();
    if (FORBIDDEN_HEADER_NAMES.has(lower)) {
      throw new CustomOperationValidationError(
        "HEADER_NOT_ALLOWED",
        `"${name}" cannot be set by a static header.`,
      );
    }
    headers[name] = value;
  }

  const hasBody = Object.keys(bodyFields).length > 0;
  if (hasBody) headers["content-type"] = "application/json";

  return {
    url: url.toString(),
    method: definition.method,
    headers,
    body: hasBody ? JSON.stringify(bodyFields) : undefined,
    resource,
  };
}
