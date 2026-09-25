import { createHash } from "node:crypto";

/**
 * JCS (RFC 8785)-compatible canonical JSON, restricted to the subset of JSON
 * Authority ever needs to hash — not an incompletely specified serializer.
 *
 * Accepted types, exactly: plain object, array, string, boolean, `null`, and
 * number *only* as a mathematically exact safe integer. Floats, `NaN`,
 * `Infinity`, `-Infinity` and `-0` are rejected outright — the whole point is
 * that no security-relevant comparison in this codebase is ever a
 * floating-point comparison, and that starts at the serialization boundary,
 * not just inside the solver.
 *
 * Rules:
 *  - Object keys are sorted by plain `<` on the raw string (UTF-16 code-unit
 *    order — exactly what JCS specifies; never locale-aware collation).
 *  - Array order is preserved exactly — plan-node order and constraint order
 *    are semantically meaningful and must never be reordered.
 *  - String escaping is delegated to `JSON.stringify` on each already
 *    key-sorted value, which is RFC 8259-compliant and handles arbitrary
 *    Unicode content correctly without any additional normalization (no
 *    NFC/NFKD) — JCS does not require string normalization, only correct
 *    escaping and canonical number formatting, and disallowing non-integer
 *    numbers here sidesteps JCS's number-formatting rules entirely rather
 *    than reimplementing them.
 *  - No wall-clock timestamp of any kind may appear in a canonicalized
 *    payload — callers are responsible for excluding time-of-computation
 *    fields before calling this, since a hash that embedded compile time
 *    could never be reproduced by a later re-run of the same computation.
 */

export type CanonicalValue =
  null | boolean | number | string | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue };

export class CanonicalizationError extends Error {}

function assertCanonicalNumber(value: number, path: string): void {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new CanonicalizationError(`${path}: only finite numbers are allowed, got ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new CanonicalizationError(`${path}: floating-point numbers are never hashed, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalizationError(`${path}: integer exceeds the safe range, got ${value}`);
  }
  if (Object.is(value, -0)) {
    throw new CanonicalizationError(`${path}: negative zero is not a canonical integer`);
  }
}

function canonicalizeValue(value: unknown, path: string): CanonicalValue {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    assertCanonicalNumber(value, path);
    return value;
  }
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.map((item, i) => canonicalizeValue(item, `${path}[${i}]`));
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, CanonicalValue> = {};
    for (const key of keys) {
      out[key] = canonicalizeValue(input[key], `${path}.${key}`);
    }
    return out;
  }

  throw new CanonicalizationError(
    `${path}: unsupported type ${typeof value} (undefined/function/symbol/bigint are never canonicalized)`,
  );
}

/** Produces the canonical string form. Deterministic: identical input always yields identical output. */
export function canonicalize(value: unknown): string {
  const canonical = canonicalizeValue(value, "$");
  return JSON.stringify(canonical);
}

/** SHA-256 of the canonical form's UTF-8 bytes, as lowercase hex — a reproducibility checksum, not an authenticity signature (see contract-compiler.ts). */
export function canonicalHash(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
