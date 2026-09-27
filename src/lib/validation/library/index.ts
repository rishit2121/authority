import { canonicalHash } from "@/lib/authorization/canonicalize";

import { CATEGORIES, type Scenario } from "../schema";
import { SCENARIOS, SCENARIO_BY_KEY } from "./scenarios";

export { SCENARIOS, SCENARIO_BY_KEY };

export interface Pack {
  key: string;
  title: string;
  description: string;
  scenarioKeys: string[];
  variants: string[];
  /** Expected verdict of every run in this pack under a healthy build (used by CI). */
  expectation: "all_pass" | "informational";
}

/** The starter pack: every scenario under the recommended (baseline) posture. Every run must pass. */
const STARTER = SCENARIOS.map((s) => s.key);

export const PACKS: Pack[] = [
  {
    key: "starter",
    title: "Starter pack (CI)",
    description:
      "Every attack scenario against the recommended posture. A pull request fails if any previously contained attack becomes allowed.",
    scenarioKeys: STARTER,
    variants: ["baseline"],
    expectation: "all_pass",
  },
  {
    key: "hardening-gaps",
    title: "Hardening gaps (demonstration)",
    description:
      "The weakened configurations (controls switched off, constraints missing). Failures here are expected and show what each layer contributes and how remediation works.",
    scenarioKeys: SCENARIOS.filter((s) => s.variants.length > 0).map((s) => s.key),
    variants: ["semantic-off", "permissive", "unpinned-recipient", "unpinned-amount", "inflated-budget"],
    expectation: "informational",
  },
];

export function packByKey(key: string): Pack | undefined {
  return PACKS.find((p) => p.key === key);
}

/** Content hash of a scenario definition: the identity of an immutable scenario version. */
export function scenarioHash(s: Scenario): string {
  return canonicalHash(s);
}

export const CATEGORY_COUNT = new Set(SCENARIOS.map((s) => s.category)).size;
export const ALL_CATEGORY_COUNT = CATEGORIES.length;
