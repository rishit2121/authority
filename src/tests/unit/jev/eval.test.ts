import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NECESSITY_EVAL_CORPUS, RISK_EVAL_CORPUS } from "@/lib/jev/eval/corpus";
import {
  buildReport,
  evaluateNecessityCorpus,
  evaluateRiskCorpus,
  necessityMetrics,
  riskMetrics,
} from "@/lib/jev/eval/run-eval";

describe("Jev evaluation corpus", () => {
  it("covers every necessity classification at least once", () => {
    const labels = new Set(NECESSITY_EVAL_CORPUS.map((c) => c.label));
    for (const required of ["required", "conditional", "unjustified", "ambiguous"]) {
      expect(labels.has(required as never)).toBe(true);
    }
  });

  it("covers every risk class at least once", () => {
    const labels = new Set(RISK_EVAL_CORPUS.map((c) => c.label));
    for (const required of ["low", "medium", "high", "critical"]) {
      expect(labels.has(required as never)).toBe(true);
    }
  });

  it("has unique case ids in each corpus", () => {
    expect(new Set(NECESSITY_EVAL_CORPUS.map((c) => c.id)).size).toBe(NECESSITY_EVAL_CORPUS.length);
    expect(new Set(RISK_EVAL_CORPUS.map((c) => c.id)).size).toBe(RISK_EVAL_CORPUS.length);
  });

  it("keeps a deliberately-hard known-gap case, so the report stays honest", () => {
    expect(NECESSITY_EVAL_CORPUS.some((c) => c.category === "false_required_risk")).toBe(true);
  });
});

describe("mock necessity provider regression floors", () => {
  it("never falsely classifies a not-required case as required, on this corpus", async () => {
    const results = await evaluateNecessityCorpus();
    const m = necessityMetrics(results);
    // The mock's own heuristic has one disclosed gap (the "false_required_risk" case) — verify it is exactly
    // that one case, not a silent regression elsewhere.
    expect(m.falseRequiredRate.numerator).toBe(1);
    expect(m.falseRequiredRate.denominator).toBeGreaterThan(m.falseRequiredRate.numerator);
  });

  it("meets its recorded accuracy floor (a regression guard on the mock, not a model accuracy claim)", async () => {
    const results = await evaluateNecessityCorpus();
    const m = necessityMetrics(results);
    expect(m.accuracy.value).toBeGreaterThanOrEqual(0.8);
  });
});

describe("mock risk provider regression floors", () => {
  it("flags every high/critical ground-truth case on this corpus", async () => {
    const results = await evaluateRiskCorpus();
    const m = riskMetrics(results);
    expect(m.detectionRate.value).toBe(1);
  });

  it("never flags a low/medium ground-truth case on this corpus", async () => {
    const results = await evaluateRiskCorpus();
    const m = riskMetrics(results);
    expect(m.falsePositiveRate.value).toBe(0);
  });
});

it.runIf(process.env.JEV_EVAL_WRITE)("writes docs/jev/EVALUATION_RESULTS.md", async () => {
  const dir = path.join(process.cwd(), "docs", "jev");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "EVALUATION_RESULTS.md"), await buildReport());
});
