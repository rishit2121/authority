import { describe, expect, it } from "vitest";

import { canonicalHash, canonicalize, CanonicalizationError } from "@/lib/authorization/canonicalize";
import golden from "./canonicalize.golden.json";

/**
 * Golden vectors generated once via a standalone `node -e` script calling
 * only `crypto.createHash` directly on a hand-written expected canonical
 * string — never by calling `canonicalize`/`canonicalHash` themselves — and
 * checked into `canonicalize.golden.json`. This pins the actual
 * specification against an independent computation, and avoids re-typing
 * 64-character hex digests by hand anywhere, which is exactly how the first
 * draft of this file got two of them wrong.
 */
describe("canonicalize — golden vectors", () => {
  it("every fixture's sha256 is well-formed", () => {
    for (const fixture of golden) {
      expect(fixture.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it.each(golden)("$name", (fixture) => {
    expect(canonicalize(fixture.input)).toBe(fixture.canonical);
    expect(canonicalHash(fixture.input)).toBe(fixture.sha256);
  });
});

describe("canonicalize — rejections", () => {
  it("rejects a float", () => {
    expect(() => canonicalize({ x: 1.5 })).toThrow(CanonicalizationError);
  });

  it("rejects NaN", () => {
    expect(() => canonicalize({ x: NaN })).toThrow(CanonicalizationError);
  });

  it("rejects Infinity and -Infinity", () => {
    expect(() => canonicalize({ x: Infinity })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ x: -Infinity })).toThrow(CanonicalizationError);
  });

  it("rejects negative zero", () => {
    expect(() => canonicalize({ x: -0 })).toThrow(CanonicalizationError);
  });

  it("rejects an unsafe integer", () => {
    expect(() => canonicalize({ x: Number.MAX_SAFE_INTEGER + 10 })).toThrow(CanonicalizationError);
  });

  it("rejects undefined, functions and symbols", () => {
    expect(() => canonicalize({ x: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ x: () => {} })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ x: Symbol("x") })).toThrow(CanonicalizationError);
  });

  it("accepts a safe integer at the boundary", () => {
    expect(() => canonicalize({ x: Number.MAX_SAFE_INTEGER })).not.toThrow();
  });
});

describe("canonicalize — determinism", () => {
  it("produces byte-identical output regardless of input key insertion order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("produces a 64-character lowercase hex digest", () => {
    const hash = canonicalHash({ any: "value" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
