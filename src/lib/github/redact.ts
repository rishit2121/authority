/**
 * Scrubs anything token- or key-shaped from text before it can leave the
 * connector (to an agent response, a log line or a stored field). GitHub
 * response bodies are never persisted; this is the guard on what is returned.
 */

const PATTERNS: Array<[string, RegExp]> = [
  ["github_token", /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g],
  ["github_pat", /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g],
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ["bearer", /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
];

export interface RedactionCounts {
  [kind: string]: number;
}

export function redactText(text: string, counts: RedactionCounts = {}): string {
  let out = text;
  for (const [kind, pattern] of PATTERNS) {
    out = out.replace(pattern, () => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      return `[REDACTED:${kind}]`;
    });
  }
  return out;
}

/** Deeply redacts every string in a JSON-like value. */
export function redactValue<T>(value: T, counts: RedactionCounts = {}): T {
  if (typeof value === "string") return redactText(value, counts) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, counts)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactValue(v, counts)]),
    ) as unknown as T;
  }
  return value;
}
