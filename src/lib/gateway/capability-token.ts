import { createHash, randomBytes } from "node:crypto";

/**
 * Capability tokens are OPAQUE, not signed.
 *
 * A capability must be revocable, single-use and invalid the instant its
 * contract, task, agent or issuing key is revoked. Every one of those is
 * database state that a consumer has to consult anyway, so a signed
 * self-describing token would add key management and a revocation list while
 * buying nothing. An opaque 256-bit random value, stored only as its SHA-256,
 * gives: nothing to forge (no structure or signature to attack), nothing
 * usable in a database read or backup, and a stable hash for lookup.
 *
 * SHA-256 (not a slow KDF) is correct here for the same reason as agent keys:
 * the input is 256 bits of CSPRNG output, not a human-chosen secret.
 *
 * Format: `authcap_v1_` + 43 base64url characters. `format_version` on the row
 * lets a future scheme (e.g. keyed hashing) coexist.
 */
export const CAPABILITY_PREFIX = "authcap_v1_";
const TOKEN_PATTERN = /^authcap_v1_[A-Za-z0-9_-]{43}$/;

export interface GeneratedCapabilityToken {
  /** Shown once, in the authorization response, then discarded. */
  plaintext: string;
  /** What the database stores. */
  hash: string;
}

export function hashCapabilityToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateCapabilityToken(): GeneratedCapabilityToken {
  const plaintext = `${CAPABILITY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plaintext, hash: hashCapabilityToken(plaintext) };
}

export function isWellFormedCapabilityToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
