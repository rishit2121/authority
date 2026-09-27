import { describe, expect, it } from "vitest";

import {
  ALL_CATEGORY_COUNT,
  PACKS,
  SCENARIOS,
  SCENARIO_BY_KEY,
  scenarioHash,
} from "@/lib/validation/library";
import { ALL_TAXONOMY } from "@/lib/validation/taxonomy";
import { CATEGORIES, scenarioSchema } from "@/lib/validation/schema";

describe("scenario library", () => {
  it("has the 28 documented scenarios with unique, well-formed keys", () => {
    expect(SCENARIOS).toHaveLength(28);
    const keys = SCENARIOS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9][a-z0-9._-]{1,79}$/);
  });

  it("every scenario is a valid, versioned definition", () => {
    for (const s of SCENARIOS) {
      expect(scenarioSchema.safeParse(s).success, s.key).toBe(true);
      expect(s.version).toBeGreaterThan(0);
      expect(s.steps.length).toBeGreaterThan(0);
    }
  });

  it("covers every category in the attack library and includes benign controls", () => {
    const used = new Set(SCENARIOS.map((s) => s.category));
    expect(used.size).toBe(ALL_CATEGORY_COUNT);
    for (const c of CATEGORIES) expect(used.has(c), c).toBe(true);
    expect(SCENARIOS.filter((s) => s.category === "benign_control").length).toBeGreaterThanOrEqual(2);
    // Attack scenarios must contain at least one attack step; only benign controls may not.
    for (const s of SCENARIOS.filter((x) => x.category !== "benign_control"))
      expect(
        s.steps.some((st) => st.kind === "attack"),
        s.key,
      ).toBe(true);
  });

  it("maps only to verified taxonomy references", () => {
    const allowed = new Set(ALL_TAXONOMY.map((t) => `${t.framework}:${t.id}`));
    for (const s of SCENARIOS)
      for (const t of s.taxonomy)
        expect(allowed.has(`${t.framework}:${t.id}`), `${s.key} ${t.id}`).toBe(true);
    for (const t of ALL_TAXONOMY) {
      if (t.framework === "mitre-atlas") expect(t.id).toMatch(/^AML\.T\d{4}(\.\d{3})?$/);
      if (t.framework === "owasp-llm-2025") expect(t.id).toMatch(/^LLM\d{2}:2025$/);
      if (t.framework === "owasp-agentic-t") expect(t.id).toMatch(/^T\d{1,2}$/);
    }
  });

  it("packs reference existing scenarios and defined variants only", () => {
    for (const p of PACKS) {
      for (const k of p.scenarioKeys) expect(SCENARIO_BY_KEY.has(k), `${p.key}:${k}`).toBe(true);
      for (const v of p.variants) {
        if (v === "baseline") continue;
        expect(
          p.scenarioKeys.some((k) => SCENARIO_BY_KEY.get(k)!.variants.some((x) => x.label === v)),
          `${p.key}:${v}`,
        ).toBe(true);
      }
    }
    expect(PACKS.find((p) => p.key === "starter")).toMatchObject({
      expectation: "all_pass",
      variants: ["baseline"],
    });
  });

  it("scenario definitions are content-addressed: stable for equal content, different after any change", () => {
    const s = SCENARIO_BY_KEY.get("recipient-substitution")!;
    expect(scenarioHash(s)).toBe(scenarioHash(JSON.parse(JSON.stringify(s))));
    expect(scenarioHash(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(scenarioHash({ ...s, version: s.version + 1 })).not.toBe(scenarioHash(s));
    expect(scenarioHash({ ...s, intent: s.intent + " " })).not.toBe(scenarioHash(s));
  });

  it("never defines an attack target outside synthetic resources", () => {
    const text = JSON.stringify(SCENARIOS);
    // Attack data may only name reserved/example domains and test resources.
    const hosts = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    for (const h of hosts)
      expect(/(example|test|invalid|localhost)/.test(h) || h.endsWith(".example"), h).toBe(true);
  });
});
