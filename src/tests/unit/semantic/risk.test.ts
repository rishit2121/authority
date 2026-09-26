import { describe, expect, it } from "vitest";

import type { SemanticSignals } from "@/lib/domain";
import { aggregateRisk, classifyDisagreement, riskLevelFor } from "@/lib/semantic/risk";

const calm: SemanticSignals = {
  taskAlignment: 0.9,
  resourceRelevance: 0.9,
  scopeExpansion: 0.05,
  externalDisclosure: 0.05,
  promptInjection: 0,
  suspiciousArgumentChange: 0.05,
  planDeviation: 0.05,
};

describe("riskLevelFor", () => {
  it("is low for a calm request", () => expect(riskLevelFor(calm, 0.8)).toBe("low"));
  it.each([
    ["promptInjection", 0.9, "critical"],
    ["externalDisclosure", 0.6, "high"],
    ["scopeExpansion", 0.5, "medium"],
  ] as const)("raises risk when %s = %s", (key, value, level) => {
    expect(riskLevelFor({ ...calm, [key]: value }, 0.8)).toBe(level);
  });

  it("downgrades a low-confidence high score one level and can never raise a level", () => {
    const s = { ...calm, promptInjection: 0.9 };
    expect(riskLevelFor(s, 0.9)).toBe("critical");
    expect(riskLevelFor(s, 0.1)).toBe("high");
    expect(riskLevelFor(calm, 0.1)).toBe("low");
  });

  it("is monotone in every risk signal", () => {
    for (const key of [
      "scopeExpansion",
      "externalDisclosure",
      "promptInjection",
      "suspiciousArgumentChange",
      "planDeviation",
    ] as const) {
      let last = -1;
      for (let v = 0; v <= 1; v += 0.1) {
        const score = aggregateRisk({ ...calm, [key]: v });
        expect(score).toBeGreaterThanOrEqual(last);
        last = score;
      }
    }
  });
});

describe("classifyDisagreement (mirrors authz.semantic_disagreement_for)", () => {
  it.each([
    ["allow", "high", "semantic_flags_permitted"],
    ["allow_constrained", "critical", "semantic_flags_permitted"],
    ["allow", "medium", "none"],
    ["allow", "low", "none"],
    ["deny", "low", "semantic_clears_denied"],
    ["replan", "low", "semantic_clears_denied"],
    ["deny", "high", "none"],
    ["clarify", "low", "none"],
    ["require_approval", "low", "none"],
    ["allow", "unknown", "none"],
    ["deny", "unknown", "none"],
  ] as const)("%s + %s -> %s", (outcome, risk, expected) => {
    expect(classifyDisagreement(outcome, risk)).toBe(expected);
  });
});
