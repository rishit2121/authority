import { describe, expect, it } from "vitest";

import {
  normalizeWildcardPattern,
  wildcardMatch,
  wildcardMatchCost,
} from "@/lib/authorization/wildcard-match";

describe("normalizeWildcardPattern", () => {
  it("collapses consecutive asterisks", () => {
    expect(normalizeWildcardPattern("a**b")).toBe("a*b");
    expect(normalizeWildcardPattern("***")).toBe("*");
    expect(normalizeWildcardPattern("a*b*c")).toBe("a*b*c");
  });
});

describe("wildcardMatch", () => {
  it("matches an exact literal", () => {
    expect(wildcardMatch("github.push_commit", "github.push_commit")).toBe(true);
    expect(wildcardMatch("github.push_commit", "github.push_commits")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(wildcardMatch("GitHub.Push_Commit", "github.push_commit")).toBe(true);
  });

  it("matches a lone '*' against anything, including empty", () => {
    expect(wildcardMatch("*", "anything at all")).toBe(true);
    expect(wildcardMatch("*", "")).toBe(true);
  });

  it("matches a star between literals, including zero characters", () => {
    expect(wildcardMatch("a*b", "ab")).toBe(true);
    expect(wildcardMatch("a*b", "axxxb")).toBe(true);
    expect(wildcardMatch("a*b", "ba")).toBe(false);
  });

  it("requires full-string match (implicit anchors)", () => {
    expect(wildcardMatch("secret", "a secret value")).toBe(false);
    expect(wildcardMatch("*secret*", "a secret value")).toBe(true);
  });

  it("matches the demo's forbidden-resource style patterns", () => {
    expect(wildcardMatch("*secret*", "github.get_repository_secret")).toBe(true);
    expect(wildcardMatch("fix-*", "fix-991")).toBe(true);
    expect(wildcardMatch("fix-*", "other-991")).toBe(false);
  });

  it("treats collapsed-consecutive-star patterns identically to a single star", () => {
    const candidate = "a".repeat(50);
    expect(wildcardMatch("*".repeat(10), candidate)).toBe(wildcardMatch("*", candidate));
  });

  it("handles empty pattern and empty candidate correctly", () => {
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("", "x")).toBe(false);
    expect(wildcardMatch("x", "")).toBe(false);
  });

  describe("adversarial patterns bounded by operation count, not wall-clock time", () => {
    // Classic regex catastrophic-backtracking bait: many star-separated
    // repeats of the same short literal against a candidate that almost, but
    // doesn't quite, match. A naive `.replace(/\*/g,'.*')` regex approach can
    // blow up here; the DP table cannot, because its cost is fixed by size
    // alone, not by how ambiguous the match attempt is.
    const pattern = "*a".repeat(60) + "!"; // never matches — candidate has no '!'
    const candidate = "a".repeat(200);

    it("computes exactly (pattern.length+1)*(candidate.length+1) cells, provably, not by timing", () => {
      const normalizedLength = pattern.replace(/\*+/g, "*").length;
      expect(wildcardMatchCost(pattern, candidate)).toBe((normalizedLength + 1) * (candidate.length + 1));
    });

    it("still returns the correct (non-matching) result for the adversarial case", () => {
      expect(wildcardMatch(pattern, candidate)).toBe(false);
    });

    it("bounds cost at the maximum allowed lengths (200x200) regardless of star density", () => {
      const maxPattern = "*".repeat(199) + "z";
      const maxCandidate = "a".repeat(200);
      expect(wildcardMatchCost(maxPattern, maxCandidate)).toBeLessThanOrEqual(201 * 201);
    });
  });
});
