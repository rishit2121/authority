import { createHash } from "node:crypto";

import type { RedactionSummary, SemanticRiskInput } from "@/lib/domain";

/**
 * Redaction of everything that leaves this process for a semantic provider.
 *
 * A provider is a third party (or a model) and must never see credentials or
 * unrelated data. This module is deliberately conservative and dependency
 * free: pattern-based secret removal, bounded sizes, and inlining of
 * base64/hex-encoded text (so an obfuscated request is *visible* to the
 * provider rather than hidden from it, while any secret inside is removed).
 *
 * It removes; it never adds authority. Its output type is the same
 * `SemanticRiskInput` shape with values replaced by markers such as
 * `[REDACTED:github_token]`, which providers treat as evidence
 * (`secret_material_in_arguments`), not as content.
 */

export interface RedactionLimits {
  maxStringChars: number;
  maxArguments: number;
  maxKeyChars: number;
  maxTotalBytes: number;
  maxDecodedChars: number;
}

export const DEFAULT_REDACTION_LIMITS: RedactionLimits = {
  maxStringChars: 500,
  maxArguments: 32,
  maxKeyChars: 64,
  maxTotalBytes: 8_192,
  maxDecodedChars: 200,
};

interface Pattern {
  kind: string;
  regex: RegExp;
  /** When set, only this capture group is replaced (e.g. the value in `password=...`). */
  group?: number;
}

const SECRET_PATTERNS: readonly Pattern[] = [
  {
    kind: "private_key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  { kind: "aws_access_key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "github_token", regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: "api_key", regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { kind: "slack_token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "stripe_key", regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}\b/g },
  { kind: "authority_runtime_key", regex: /\bauthority_rk_[0-9a-f]{16,}\b/g },
  { kind: "jwt", regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: "bearer_token", regex: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/g, group: 1 },
  {
    kind: "connection_string",
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@[^\s]+/gi,
    group: 1,
  },
  {
    kind: "credential_assignment",
    regex:
      /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token)\s*[:=]\s*["']?([^\s"',;]{6,})/gi,
    group: 1,
  },
];

const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const BASE64_CANDIDATE = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/=])/g;
const HEX_CANDIDATE = /\b(?:[0-9a-fA-F]{2}){12,}\b/g;
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function printableRatio(value: string): number {
  if (value.length === 0) return 0;
  let printable = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code >= 32 && code < 127) || code === 9 || code === 10 || code === 13) printable += 1;
  }
  return printable / value.length;
}

class Counter {
  readonly counts: Record<string, number> = {};
  decodedSegments = 0;
  truncated = false;
  bump(kind: string): void {
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
  }
}

function tryDecode(candidate: string, encoding: "base64" | "hex"): string | null {
  try {
    const decoded = Buffer.from(candidate, encoding).toString("utf8");
    return decoded.length >= 6 && printableRatio(decoded) >= 0.9 ? decoded : null;
  } catch {
    return null;
  }
}

function redactString(input: string, limits: RedactionLimits, counter: Counter, depth = 0): string {
  let text = input;

  for (const { kind, regex, group } of SECRET_PATTERNS) {
    text = text.replace(regex, (...args: unknown[]) => {
      const match = args[0] as string;
      counter.bump(kind);
      if (group === undefined) return `[REDACTED:${kind}]`;
      const captured = args[group] as string;
      return match.replace(captured, `[REDACTED:${kind}]`);
    });
  }

  // Inline encoded text (one level of nesting) so obfuscation cannot hide a
  // request from the provider; anything secret inside is redacted in turn.
  if (depth === 0) {
    const inline = (encoding: "base64" | "hex") => (match: string) => {
      const decoded = tryDecode(match, encoding);
      if (decoded === null) return match;
      counter.decodedSegments += 1;
      counter.bump("decoded_segment");
      const safe = redactString(decoded.slice(0, limits.maxDecodedChars), limits, counter, depth + 1);
      return `[DECODED:${safe}]`;
    };
    text = text.replace(HEX_CANDIDATE, inline("hex")).replace(BASE64_CANDIDATE, inline("base64"));
  }

  text = text.replace(LONG_TOKEN, (token) => {
    if (token.startsWith("[")) return token;
    if (/^[0-9a-fA-F]+$/.test(token)) return token; // hashes / commit ids are identifiers, not secrets
    if (shannonEntropy(token) < 4.2) return token;
    counter.bump("high_entropy");
    return "[REDACTED:high_entropy]";
  });

  text = text.replace(EMAIL, (_m, domain: string) => {
    counter.bump("email");
    return `[email:${domain.toLowerCase()}]`;
  });

  if (text.length > limits.maxStringChars) {
    counter.truncated = true;
    text = `${text.slice(0, limits.maxStringChars)}…`;
  }
  return text;
}

/**
 * Secret material only (keys, tokens, credentials), for text whose other
 * content a reviewer must still see verbatim -- recipients, ids, amounts.
 * Returns the number of replacements per kind.
 */
export function removeSecretMaterial(input: string): { text: string; removed: Record<string, number> } {
  const removed: Record<string, number> = {};
  let text = input;
  for (const { kind, regex, group } of SECRET_PATTERNS) {
    text = text.replace(regex, (...args: unknown[]) => {
      const match = args[0] as string;
      removed[kind] = (removed[kind] ?? 0) + 1;
      if (group === undefined) return `[REDACTED:${kind}]`;
      return match.replace(args[group] as string, `[REDACTED:${kind}]`);
    });
  }
  return { text, removed };
}

type ArgValue = string | number | boolean | string[];

export interface RedactableInput {
  taskIntent: string;
  tool: string;
  operation: string;
  resource: string | null;
  arguments: Record<string, ArgValue>;
  contractAllowedTools: string[];
  priorCalls: { tool: string; arguments: Record<string, ArgValue> }[];
}

function redactArguments(
  args: Record<string, ArgValue>,
  limits: RedactionLimits,
  counter: Counter,
): Record<string, ArgValue> {
  const out: Record<string, ArgValue> = {};
  let kept = 0;
  for (const [rawKey, value] of Object.entries(args)) {
    if (kept >= limits.maxArguments) {
      counter.truncated = true;
      break;
    }
    const key = rawKey.slice(0, limits.maxKeyChars);
    if (rawKey.length > limits.maxKeyChars) counter.truncated = true;
    if (typeof value === "string") out[key] = redactString(value, limits, counter);
    else if (Array.isArray(value)) out[key] = value.slice(0, 16).map((v) => redactString(v, limits, counter));
    else out[key] = value;
    kept += 1;
  }
  return out;
}

export function redactSemanticInput(
  input: RedactableInput,
  limits: RedactionLimits = DEFAULT_REDACTION_LIMITS,
): { input: SemanticRiskInput; summary: RedactionSummary } {
  const counter = new Counter();

  const redacted: SemanticRiskInput = {
    taskIntent: redactString(input.taskIntent, limits, counter) || "(empty)",
    tool: input.tool,
    operation: redactString(input.operation, limits, counter) || "(empty)",
    resource: input.resource === null ? null : redactString(input.resource, limits, counter),
    arguments: redactArguments(input.arguments, limits, counter),
    contractAllowedTools: input.contractAllowedTools.slice(0, 64),
    priorCalls: input.priorCalls.slice(-5).map((call) => ({
      tool: call.tool,
      arguments: redactArguments(call.arguments, limits, counter),
    })),
  };

  // Hard total-size cap: shed prior calls, then arguments, until it fits.
  let serialized = JSON.stringify(redacted);
  while (Buffer.byteLength(serialized) > limits.maxTotalBytes && redacted.priorCalls.length > 0) {
    redacted.priorCalls.shift();
    counter.truncated = true;
    serialized = JSON.stringify(redacted);
  }
  const keys = Object.keys(redacted.arguments);
  while (Buffer.byteLength(serialized) > limits.maxTotalBytes && keys.length > 0) {
    delete redacted.arguments[keys.pop() as string];
    counter.truncated = true;
    serialized = JSON.stringify(redacted);
  }

  return {
    input: redacted,
    summary: {
      schemaVersion: 1,
      counts: counter.counts,
      truncated: counter.truncated,
      decodedSegments: counter.decodedSegments,
      inputBytes: Buffer.byteLength(serialized),
    },
  };
}

/** Stable SHA-256 of the *redacted* payload — recorded instead of the payload itself. */
export function hashRedactedInput(input: SemanticRiskInput): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
