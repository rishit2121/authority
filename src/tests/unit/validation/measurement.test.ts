import { describe, expect, it } from "vitest";

import { aggregateMetrics, emptyMetrics, percentile, rate } from "@/lib/validation/metrics";
import type { RunMetrics, RunResult } from "@/lib/validation/schema";

const run = (m: Partial<RunMetrics>, verdict: RunResult["verdict"] = "pass", key = "s"): RunResult => ({
  scenarioKey: key,
  scenarioVersion: 1,
  variant: "baseline",
  repetition: 1,
  seed: 1,
  status: "completed",
  verdict,
  steps: [],
  effects: [],
  metrics: { ...emptyMetrics(), ...m },
  durationMs: 1,
});

describe("rate (Wilson interval)", () => {
  it("keeps numerator and denominator and never invents a value for an empty sample", () => {
    expect(rate(0, 0)).toEqual({ numerator: 0, denominator: 0, value: null, low: null, high: null });
  });
  it("is wide for small samples and never leaves [0,1]", () => {
    const r = rate(3, 3);
    expect(r.value).toBe(1);
    expect(r.high).toBeLessThanOrEqual(1);
    expect(r.low!).toBeLessThan(0.5); // 3/3 is not proof of 100%
    const zero = rate(0, 5);
    expect(zero.low).toBe(0);
    expect(zero.high!).toBeGreaterThan(0.3);
    const big = rate(500, 1000);
    expect(big.high! - big.low!).toBeLessThan(0.07);
  });
});

describe("percentile", () => {
  it("returns null with no samples and a sample value otherwise", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 100], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
  });
});

describe("aggregateMetrics", () => {
  const contained = run({
    attackSteps: 3,
    attackBlocked: 3,
    benignSteps: 2,
    unusedAuthority: { allowedTools: 4, exercisedTools: 1 },
  });
  const leak = run(
    { attackSteps: 2, attackBlocked: 1, attackAllowed: 1, unauthorizedEffects: 1 },
    "fail",
    "leaky",
  );
  const m = aggregateMetrics([contained, leak], 25);

  it("is always labeled synthetic and carries limitations", () => {
    expect(m.synthetic).toBe(true);
    expect(m.limitations.length).toBeGreaterThan(3);
    expect(m.limitations.join(" ")).toMatch(/synthetic/i);
  });
  it("counts runs and attack outcomes with their denominators", () => {
    expect(m.runs).toEqual({ total: 2, passed: 1, failed: 1, errored: 0 });
    expect(m.unauthorizedOperationBlockRate).toMatchObject({ numerator: 4, denominator: 5 });
    expect(m.falseNegativeRate).toMatchObject({ numerator: 1, denominator: 5 });
    expect(m.attackContainmentRate).toMatchObject({ numerator: 1, denominator: 2 });
  });
  it("reports blast radius by scenario, and least-privilege exposure as unused authority", () => {
    expect(m.residualBlastRadius).toEqual({
      unauthorizedEffects: 1,
      scenariosWithEffects: ["leaky@baseline"],
    });
    expect(m.leastPrivilegeExposure).toMatchObject({ numerator: 3, denominator: 4 });
  });
  it("has no composite score", () => {
    expect(Object.keys(m).some((k) => /score/i.test(k))).toBe(false);
  });
  it("handles zero runs without dividing by zero", () => {
    const empty = aggregateMetrics([], 25);
    expect(empty.attackContainmentRate.value).toBeNull();
    expect(empty.decisionLatencyMs).toEqual({ p50: null, p95: null, samples: 0 });
  });
});
