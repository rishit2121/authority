import { describe, expect, it } from "vitest";

import { responsibleControl } from "@/lib/validation/engine/controls";
import { compareOutcome, falsePositive, leaked } from "@/lib/validation/engine/evaluate";
import { hashSeed, prng, resolveTemplates, templateContext } from "@/lib/validation/engine/templates";
import type { StepActual } from "@/lib/validation/schema";

const actual = (over: Partial<StepActual> = {}): StepActual => ({
  reasonCodes: [],
  capability: "n/a",
  execution: "n/a",
  ...over,
});

describe("compareOutcome", () => {
  it("passes when every stated expectation holds", () => {
    expect(
      compareOutcome(
        {
          decision: ["deny"],
          capability: "not_issued",
          execution: "blocked",
          control: ["argument_constraints"],
        },
        actual({
          finalDecision: "deny",
          capability: "not_issued",
          execution: "blocked",
          reasonCodes: ["CONSTRAINT_VIOLATION"],
        }),
      ),
    ).toEqual([]);
  });

  it("reports each mismatch in words", () => {
    const m = compareOutcome(
      { decision: ["deny", "replan"], capability: "not_issued" },
      actual({ finalDecision: "allow", capability: "issued" }),
    );
    expect(m).toHaveLength(2);
    expect(m[0]).toContain("expected deny or replan, got allow");
    expect(m[1]).toContain("capability");
  });

  it("checks parallel-execution counts and replay flags", () => {
    expect(compareOutcome({ executedAtMost: 1 }, actual({ executedCount: 2 }))).toHaveLength(1);
    expect(compareOutcome({ executedExactly: 1 }, actual({ executedCount: 1 }))).toEqual([]);
    expect(compareOutcome({ replayed: true }, actual({ replayed: false }))).toHaveLength(1);
  });

  it("does not demand a decision from a step that had none (execute-only steps)", () => {
    expect(compareOutcome({ execution: "executed" }, actual({ execution: "executed" }))).toEqual([]);
  });
});

describe("leaked / falsePositive", () => {
  const blocked = { expect: { decision: ["deny" as const], execution: "blocked" as const } };
  it("a step that should have been blocked but executed leaked", () => {
    expect(leaked(blocked, actual({ execution: "executed", finalDecision: "allow" }))).toBe(true);
  });
  it("a correct block is neither a leak nor a false positive", () => {
    const a = actual({ execution: "blocked", finalDecision: "deny" });
    expect(leaked(blocked, a)).toBe(false);
    expect(falsePositive(blocked, a)).toBe(false);
  });
  it("a permitted decision for an attack that expected a denial leaked even without execution", () => {
    expect(leaked(blocked, actual({ finalDecision: "allow_constrained", capability: "issued" }))).toBe(true);
  });
  it("a legitimate step that was refused is a false positive", () => {
    const benign = {
      expect: { decision: ["allow" as const, "allow_constrained" as const], execution: "executed" as const },
    };
    expect(falsePositive(benign, actual({ finalDecision: "deny", execution: "blocked" }))).toBe(true);
    expect(leaked(benign, actual({ finalDecision: "deny", execution: "blocked" }))).toBe(false);
  });
});

describe("responsibleControl", () => {
  const cases: Array<[Partial<StepActual>, string]> = [
    [{ reasonCodes: ["CONSTRAINT_VIOLATION"] }, "argument_constraints"],
    [{ reasonCodes: ["TOOL_NOT_IN_CONTRACT"] }, "contract_scope"],
    [{ reasonCodes: ["FORBIDDEN_RESOURCE"] }, "policy"],
    [{ reasonCodes: ["INVOCATION_LIMIT_REACHED"] }, "budget"],
    [{ reasonCodes: ["SEMANTIC_HIGH_RISK"] }, "semantic"],
    [{ reasonCodes: ["POLICY_REQUIRES_APPROVAL"] }, "approval"],
    [{ finalDecision: "require_approval" }, "approval"],
    [{ resultCode: "CAPABILITY_ALREADY_USED", execution: "blocked" }, "capability"],
    [{ resultCode: "REPOSITORY_NOT_ALLOWED", execution: "blocked" }, "connector_binding"],
    [{ reasonCodes: ["UNAUTHENTICATED"] }, "gateway_auth"],
    [{ reasonCodes: [], execution: "executed" }, "none"],
  ];
  it.each(cases)("%j -> %s", (a, expected) => {
    expect(responsibleControl(actual(a))).toBe(expected);
  });
  it("is derived only from what the gateway reported: gateway auth outranks everything", () => {
    expect(responsibleControl(actual({ reasonCodes: ["CONSTRAINT_VIOLATION", "invalid_credential"] }))).toBe(
      "gateway_auth",
    );
  });
});

describe("determinism helpers", () => {
  it("templates depend only on task id and seed", () => {
    const a = templateContext("11111111-2222-3333-4444-555555555555", 7);
    expect(a).toEqual(templateContext("11111111-2222-3333-4444-555555555555", 7));
    expect(a).not.toEqual(templateContext("11111111-2222-3333-4444-555555555555", 8));
    expect(resolveTemplates({ x: ["{{branch}}", { y: "{{task8}}-{{tag}}" }] }, a)).toEqual({
      x: [a.branch, { y: `${a.task8}-${a.tag}` }],
    });
  });
  it("prng and hashSeed are reproducible", () => {
    const r1 = prng(42);
    const r2 = prng(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    expect(hashSeed("a", 1)).toBe(hashSeed("a", 1));
    expect(hashSeed("a", 1)).not.toBe(hashSeed("a", 2));
  });
});
