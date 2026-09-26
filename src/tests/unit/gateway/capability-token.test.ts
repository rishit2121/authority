import { describe, expect, it } from "vitest";

import {
  CAPABILITY_PREFIX,
  generateCapabilityToken,
  hashCapabilityToken,
  isWellFormedCapabilityToken,
} from "@/lib/gateway/capability-token";

describe("capability tokens", () => {
  it("are opaque, prefixed, 256-bit random values", () => {
    const t = generateCapabilityToken();
    expect(t.plaintext.startsWith(CAPABILITY_PREFIX)).toBe(true);
    expect(isWellFormedCapabilityToken(t.plaintext)).toBe(true);
    expect(t.plaintext.length).toBe(CAPABILITY_PREFIX.length + 43);
  });

  it("never repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateCapabilityToken().plaintext));
    expect(seen.size).toBe(500);
  });

  it("store only a SHA-256 that cannot be turned back into the token", () => {
    const t = generateCapabilityToken();
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).toBe(hashCapabilityToken(t.plaintext));
    expect(t.hash).not.toContain(t.plaintext.slice(CAPABILITY_PREFIX.length, CAPABILITY_PREFIX.length + 10));
  });

  it("hash to a stable, distinct value per token", () => {
    expect(hashCapabilityToken("authcap_v1_a")).toBe(hashCapabilityToken("authcap_v1_a"));
    expect(hashCapabilityToken("authcap_v1_a")).not.toBe(hashCapabilityToken("authcap_v1_b"));
  });

  it.each([
    "",
    "authcap_v1_short",
    "authcap_v2_" + "a".repeat(43),
    "authority_rk_" + "a".repeat(43),
    "authcap_v1_" + "!".repeat(43),
    "authcap_v1_" + "a".repeat(44),
  ])("rejects a malformed token: %s", (bad) => expect(isWellFormedCapabilityToken(bad)).toBe(false));
});
