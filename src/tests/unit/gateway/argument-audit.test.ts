import { describe, expect, it } from "vitest";

import {
  MAX_ARGUMENT_KEYS,
  MAX_STRING_CHARS,
  PayloadTooLargeError,
  assertArgumentLimits,
  buildArgumentAudit,
  sanitizeResource,
} from "@/lib/gateway/argument-audit";

const GH = "ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6";

describe("buildArgumentAudit", () => {
  it("keeps identifier-like values so an auditor can see which resource was touched", () => {
    const audit = buildArgumentAudit({ repository: "payments-api", issue_number: "991", branch: "fix-991" });
    const byKey = Object.fromEntries(audit.entries.map((e) => [e.key, e]));
    expect(byKey.repository.value).toBe("payments-api");
    expect(byKey.issue_number.value).toBe("991");
    expect(byKey.branch.value).toBe("fix-991");
  });

  it("reduces free text to type, length and a short hash — never the text", () => {
    const text = "Please summarize the customer complaint about invoice 88 — highly confidential";
    const audit = buildArgumentAudit({ body: text, title: "x" });
    const body = audit.entries.find((e) => e.key === "body")!;
    expect(body).toMatchObject({ type: "string", length: text.length });
    expect(body.value).toBeUndefined();
    expect(body.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(audit)).not.toContain("complaint");
  });

  it("drops the value of an identifier-named key when it looks like a secret or an email", () => {
    const audit = buildArgumentAudit({
      customer: GH,
      owner: "alice@corp.example",
      repo: "AKIAIOSFODNN7EXAMPLE",
    });
    for (const e of audit.entries) expect(e.value).toBeUndefined();
    expect(JSON.stringify(audit)).not.toContain("ghp_");
    expect(JSON.stringify(audit)).not.toContain("alice@");
    expect(JSON.stringify(audit)).not.toContain("AKIA");
  });

  it("keeps numbers and booleans only under identifier-like keys", () => {
    const audit = buildArgumentAudit({ amount: 2500, secretish: 424242, force: true });
    const byKey = Object.fromEntries(audit.entries.map((e) => [e.key, e]));
    expect(byKey.amount.value).toBe(2500);
    expect(byKey.secretish.value).toBeUndefined();
    expect(byKey.force.value).toBeUndefined();
  });

  it("summarizes arrays without their contents", () => {
    const audit = buildArgumentAudit({ labels: ["bug", "p1", GH] });
    expect(audit.entries[0]).toMatchObject({ type: "string_array", length: 3 });
    expect(JSON.stringify(audit)).not.toContain("ghp_");
  });

  it("is deterministic", () => {
    expect(buildArgumentAudit({ a: "1", b: "2" })).toEqual(buildArgumentAudit({ a: "1", b: "2" }));
  });
});

describe("limits", () => {
  it("rejects too many arguments", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_ARGUMENT_KEYS + 1 }, (_, i) => [`k${i}`, "v"]));
    expect(() => assertArgumentLimits(many)).toThrow(PayloadTooLargeError);
  });
  it("rejects an oversized value without echoing it", () => {
    const value = "x".repeat(MAX_STRING_CHARS + 1);
    try {
      assertArgumentLimits({ a: value });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PayloadTooLargeError);
      expect((error as Error).message).not.toContain("xxxx");
    }
  });
  it("rejects an oversized total payload", () => {
    const big = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, "y".repeat(3000)]));
    expect(() => assertArgumentLimits(big)).toThrow(PayloadTooLargeError);
  });
  it("rejects an over-long key and an over-long list", () => {
    expect(() => assertArgumentLimits({ ["k".repeat(65)]: "v" })).toThrow(PayloadTooLargeError);
    expect(() => assertArgumentLimits({ a: Array.from({ length: 65 }, () => "v") })).toThrow(
      PayloadTooLargeError,
    );
  });
});

describe("sanitizeResource", () => {
  it("keeps a short identifier-shaped resource", () =>
    expect(sanitizeResource("acme/payments-api#991")).toBe("acme/payments-api#991"));
  it("returns null for absent or blank", () => {
    expect(sanitizeResource(undefined)).toBeNull();
    expect(sanitizeResource("   ")).toBeNull();
  });
  it("replaces anything with a secret pattern, an email or spaces by a hash marker", () => {
    for (const bad of [GH, "alice@corp.example", "free text with spaces"]) {
      const out = sanitizeResource(bad)!;
      expect(out).toMatch(/^\[redacted:[0-9a-f]{12}\]$/);
      expect(out).not.toContain(bad);
    }
  });
  it("rejects an over-long resource", () =>
    expect(() => sanitizeResource("a".repeat(201))).toThrow(PayloadTooLargeError));
});
