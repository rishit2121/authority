import { createHash, randomBytes } from "node:crypto";

/**
 * Task-session tokens are OPAQUE, not signed -- the same reasoning as
 * capability-token.ts: a session must be revocable and invalid the instant
 * its issuing credential, agent, or bound contract is no longer good, which
 * requires a database lookup anyway, so a signed self-describing token adds
 * key management for no benefit. An opaque 256-bit random value, stored
 * only as its SHA-256, gives nothing to forge and a stable hash for lookup.
 *
 * Format: `authority_ts_` + 43 base64url characters, matching the shape
 * documented as planned in docs/api/OPENAPI.yaml -- this is that token,
 * now implemented.
 */
export const TASK_SESSION_PREFIX = "authority_ts_";
const TOKEN_PATTERN = /^authority_ts_[A-Za-z0-9_-]{43}$/;

export interface GeneratedTaskSessionToken {
  /** Shown once, in the session-creation response, then discarded. */
  plaintext: string;
  /** What the database stores. */
  hash: string;
}

export function hashTaskSessionToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateTaskSessionToken(): GeneratedTaskSessionToken {
  const plaintext = `${TASK_SESSION_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plaintext, hash: hashTaskSessionToken(plaintext) };
}

export function isWellFormedTaskSessionToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
