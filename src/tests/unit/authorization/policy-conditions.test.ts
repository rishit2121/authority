import { describe, expect, it } from "vitest";

import {
  evaluatePolicyCondition,
  isSupportedPolicyKey,
  MAX_POLICY_CANDIDATE_LENGTH,
  MAX_POLICY_PATTERN_LENGTH,
  validatePolicyCandidate,
  validatePolicyPattern,
} from "@/lib/authorization/policy-conditions";

describe("isSupportedPolicyKey", () => {
  it("accepts exactly the closed set", () => {
    expect(isSupportedPolicyKey("tool")).toBe(true);
    expect(isSupportedPolicyKey("resource")).toBe(true);
    expect(isSupportedPolicyKey("provider")).toBe(true);
  });

  it("rejects anything outside the closed set", () => {
    expect(isSupportedPolicyKey("argument")).toBe(false);
    expect(isSupportedPolicyKey("")).toBe(false);
    expect(isSupportedPolicyKey("Tool")).toBe(false);
  });
});

describe("validatePolicyPattern / validatePolicyCandidate", () => {
  it("accepts a normal printable-ASCII value under the length cap", () => {
    expect(validatePolicyPattern("*secret*")).toBe("valid");
    expect(validatePolicyCandidate("github.get_repository_secret")).toBe("valid");
  });

  it("rejects a value over the length cap", () => {
    expect(validatePolicyPattern("a".repeat(MAX_POLICY_PATTERN_LENGTH + 1))).toBe("too_long");
    expect(validatePolicyCandidate("a".repeat(MAX_POLICY_CANDIDATE_LENGTH + 1))).toBe("too_long");
  });

  it("accepts a value at exactly the length cap", () => {
    expect(validatePolicyPattern("a".repeat(MAX_POLICY_PATTERN_LENGTH))).toBe("valid");
  });

  it("rejects control characters", () => {
    expect(validatePolicyPattern("secret\u0000")).toBe("not_printable_ascii");
    expect(validatePolicyPattern("secret\n")).toBe("not_printable_ascii");
    expect(validatePolicyPattern("secret\t")).toBe("not_printable_ascii");
  });

  it("rejects non-ASCII characters", () => {
    expect(validatePolicyPattern("sécret")).toBe("not_printable_ascii");
    expect(validatePolicyPattern("秘密")).toBe("not_printable_ascii");
  });

  it("accepts an empty string", () => {
    expect(validatePolicyPattern("")).toBe("valid");
  });
});

describe("evaluatePolicyCondition", () => {
  it("returns true/false for valid patterns and candidates", () => {
    expect(evaluatePolicyCondition("*secret*", "github.get_repository_secret")).toBe(true);
    expect(evaluatePolicyCondition("*secret*", "github.read_issue")).toBe(false);
  });

  it("returns null (not false) when the pattern is malformed — never a silent pass", () => {
    expect(evaluatePolicyCondition("secret\u0000", "github.get_repository_secret")).toBeNull();
    expect(evaluatePolicyCondition("a".repeat(300), "x")).toBeNull();
  });

  it("returns null when the candidate is malformed", () => {
    expect(evaluatePolicyCondition("*secret*", "秘密")).toBeNull();
  });
});
