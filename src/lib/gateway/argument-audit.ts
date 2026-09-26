import { createHash } from "node:crypto";

import { redactSemanticInput } from "@/lib/semantic/redaction";

/**
 * The only representation of a request's arguments that is ever persisted.
 *
 * Raw arguments are evaluated in the database transaction and dropped. What is
 * stored instead is, per argument: its key, type, length, a short one-way
 * hash, and — only for a small allow-list of identifier-like keys whose values
 * are short, contain no secret pattern and no email — the value itself, so an
 * audit reader can still see *which* repository or issue a call touched.
 * Everything else (message bodies, free text, anything that trips the secret
 * redactor) is reduced to a hash. Nothing here can be reversed into a secret.
 */

export const MAX_ARGUMENT_KEYS = 64;
export const MAX_KEY_CHARS = 64;
export const MAX_STRING_CHARS = 4096;
export const MAX_ARRAY_ITEMS = 64;
export const MAX_ARGUMENT_BYTES = 16_384;
export const MAX_RESOURCE_CHARS = 200;

/** Keys whose values name a resource rather than carry content. */
const IDENTIFIER_KEY =
  /^(?:repo|repository|project|org|owner|customer(?:_id)?|account(?:_id)?|user(?:_id)?|invoice(?:_id)?|payment(?:_id)?|charge(?:_id)?|subscription(?:_id)?|issue(?:_number)?|pull(?:_number)?|ticket(?:_id)?|branch|channel|number|id|amount|quantity|currency)$/i;
const MAX_VALUE_CHARS = 100;

export type ArgumentValue = string | number | boolean | string[];

export interface ArgumentAuditEntry {
  key: string;
  type: "string" | "number" | "boolean" | "string_array";
  length: number;
  hash: string;
  value?: string | number | boolean;
}

export interface ArgumentAudit {
  schemaVersion: 1;
  count: number;
  truncated: boolean;
  entries: ArgumentAuditEntry[];
}

export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

const shortHash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);

/** Throws {@link PayloadTooLargeError}. The message never contains a value. */
export function assertArgumentLimits(args: Record<string, ArgumentValue>): void {
  const keys = Object.keys(args);
  if (keys.length > MAX_ARGUMENT_KEYS) throw new PayloadTooLargeError("too many arguments");
  for (const key of keys) {
    if (key.length > MAX_KEY_CHARS) throw new PayloadTooLargeError("argument name too long");
    const value = args[key];
    if (typeof value === "string" && value.length > MAX_STRING_CHARS)
      throw new PayloadTooLargeError("argument value too long");
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) throw new PayloadTooLargeError("argument list too long");
      if (value.some((v) => v.length > MAX_STRING_CHARS))
        throw new PayloadTooLargeError("argument value too long");
    }
  }
  if (Buffer.byteLength(JSON.stringify(args)) > MAX_ARGUMENT_BYTES)
    throw new PayloadTooLargeError("arguments too large");
}

function safeIdentifier(value: string): boolean {
  if (value.length === 0 || value.length > MAX_VALUE_CHARS) return false;
  const { input, summary } = redactSemanticInput({
    taskIntent: "x",
    tool: "a.b",
    operation: "x",
    resource: null,
    arguments: { v: value },
    contractAllowedTools: [],
    priorCalls: [],
  });
  const redacted = input.arguments.v;
  return Object.keys(summary.counts).length === 0 && redacted === value && !/@/.test(value);
}

export function buildArgumentAudit(args: Record<string, ArgumentValue>): ArgumentAudit {
  assertArgumentLimits(args);
  const entries: ArgumentAuditEntry[] = Object.entries(args).map(([key, value]) => {
    if (typeof value === "number" || typeof value === "boolean") {
      return {
        key,
        type: typeof value === "number" ? "number" : "boolean",
        length: String(value).length,
        hash: shortHash(String(value)),
        ...(IDENTIFIER_KEY.test(key) ? { value } : {}),
      };
    }
    if (Array.isArray(value)) {
      return { key, type: "string_array", length: value.length, hash: shortHash(JSON.stringify(value)) };
    }
    return {
      key,
      type: "string",
      length: value.length,
      hash: shortHash(value),
      ...(IDENTIFIER_KEY.test(key) && safeIdentifier(value) ? { value } : {}),
    };
  });
  return { schemaVersion: 1, count: entries.length, truncated: false, entries };
}

/** A resource identifier is kept only when it is short, identifier-shaped and free of secret patterns; otherwise it becomes a hash. */
export function sanitizeResource(resource: string | undefined): string | null {
  if (resource === undefined) return null;
  const trimmed = resource.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_RESOURCE_CHARS) throw new PayloadTooLargeError("resource identifier too long");
  const { summary } = redactSemanticInput({
    taskIntent: "x",
    tool: "a.b",
    operation: "x",
    resource: trimmed,
    arguments: {},
    contractAllowedTools: [],
    priorCalls: [],
  });
  const clean = Object.keys(summary.counts).length === 0 && /^[A-Za-z0-9_.:/#-]{1,200}$/.test(trimmed);
  return clean ? trimmed : `[redacted:${shortHash(trimmed)}]`;
}
