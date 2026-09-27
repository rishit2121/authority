import type { Control, RunMetrics, RunResult } from "./schema";

export interface Rate {
  numerator: number;
  denominator: number;
  /** null when there is nothing to measure. */
  value: number | null;
  /** 95% Wilson score interval; null when the denominator is 0. */
  low: number | null;
  high: number | null;
}

/** Wilson score interval: honest about small samples (a scenario pack is dozens of steps, not thousands). */
export function rate(numerator: number, denominator: number): Rate {
  if (denominator <= 0) return { numerator, denominator, value: null, low: null, high: null };
  const p = numerator / denominator;
  const z = 1.96;
  const n = denominator;
  const center = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return {
    numerator,
    denominator,
    value: p,
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
}

export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

export const emptyMetrics = (): RunMetrics => ({
  attackSteps: 0,
  attackBlocked: 0,
  attackAllowed: 0,
  benignSteps: 0,
  benignBlocked: 0,
  unauthorizedEffects: 0,
  disagreements: 0,
  replayAttempts: 0,
  replayBlocked: 0,
  approvalBypassAttempts: 0,
  approvalBypassBlocked: 0,
  authorizeLatenciesMs: [],
  timeToFirstBlockMs: null,
  unusedAuthority: { allowedTools: 0, exercisedTools: 0 },
  controlsExercised: [],
});

export interface CampaignMetrics {
  synthetic: true;
  runs: { total: number; passed: number; failed: number; errored: number };
  unauthorizedOperationBlockRate: Rate;
  attackContainmentRate: Rate;
  falseNegativeRate: Rate;
  falsePositiveRate: Rate;
  leastPrivilegeExposure: Rate;
  residualBlastRadius: { unauthorizedEffects: number; scenariosWithEffects: string[] };
  deterministicSemanticDisagreement: Rate;
  capabilityReplayResistance: Rate;
  approvalBypassResistance: Rate;
  decisionLatencyMs: { p50: number | null; p95: number | null; samples: number };
  timeToDetectionMs: { median: number | null; samples: number };
  controlCoverage: { controlsExercised: Control[]; controlsAvailable: number; scenarioCategories: number };
  regression: { total: number; passing: number; failing: number };
  limitations: string[];
}

export const CONTROL_COUNT = 10;

export const STANDARD_LIMITATIONS = [
  "Synthetic results: scenarios run against fake tenants, mock integrations and a rule-based mock semantic provider. They measure what these controls contain in these scenarios, not a production guarantee.",
  "Rates come from small samples; the intervals shown are 95% Wilson intervals and are wide for few steps.",
  "Scenarios were written by the same team that wrote the controls; a passing pack shows the known attacks are contained, not that unknown attacks are.",
  "The semantic layer is exercised with a deterministic heuristic provider, not a live model; its detection numbers are not model accuracy.",
  "Human approver rules (role, self-approval, distinct approvers) are covered by database tests, not simulated here.",
];

/** Aggregates run results into the reported measurements. Every number keeps its numerator and denominator. */
export function aggregateMetrics(
  runs: readonly RunResult[],
  categoriesInLibrary = 0,
  regressions?: { total: number; passing: number },
): CampaignMetrics {
  const m = runs.map((r) => r.metrics);
  const sum = (f: (x: RunMetrics) => number) => m.reduce((s, x) => s + f(x), 0);

  const attackSteps = sum((x) => x.attackSteps);
  const attackAllowed = sum((x) => x.attackAllowed);
  const attackBlocked = sum((x) => x.attackBlocked);
  const attackRuns = runs.filter((r) => r.metrics.attackSteps > 0);
  const contained = attackRuns.filter(
    (r) => r.metrics.attackAllowed === 0 && r.metrics.unauthorizedEffects === 0,
  ).length;
  const benignSteps = sum((x) => x.benignSteps);
  const latencies = m.flatMap((x) => x.authorizeLatenciesMs);
  const firstBlocks = m.map((x) => x.timeToFirstBlockMs).filter((v): v is number => v !== null);
  const allowedTools = sum((x) => x.unusedAuthority.allowedTools);
  const exercised = sum((x) => x.unusedAuthority.exercisedTools);
  const controls = [...new Set(m.flatMap((x) => x.controlsExercised))].filter(
    (c) => c !== "none",
  ) as Control[];
  const effectRuns = runs.filter((r) => r.metrics.unauthorizedEffects > 0);
  const authorizeSteps = runs.reduce(
    (s, r) => s + r.steps.filter((st) => st.actual.deterministicDecision !== undefined).length,
    0,
  );

  return {
    synthetic: true,
    runs: {
      total: runs.length,
      passed: runs.filter((r) => r.verdict === "pass").length,
      failed: runs.filter((r) => r.verdict === "fail").length,
      errored: runs.filter((r) => r.verdict === "error").length,
    },
    unauthorizedOperationBlockRate: rate(attackBlocked, attackSteps),
    attackContainmentRate: rate(contained, attackRuns.length),
    falseNegativeRate: rate(attackAllowed, attackSteps),
    falsePositiveRate: rate(
      sum((x) => x.benignBlocked),
      benignSteps,
    ),
    // Share of the authority the contracts grant that the legitimate work never used.
    leastPrivilegeExposure: rate(Math.max(0, allowedTools - exercised), allowedTools),
    residualBlastRadius: {
      unauthorizedEffects: sum((x) => x.unauthorizedEffects),
      scenariosWithEffects: [...new Set(effectRuns.map((r) => `${r.scenarioKey}@${r.variant}`))],
    },
    deterministicSemanticDisagreement: rate(
      sum((x) => x.disagreements),
      authorizeSteps,
    ),
    capabilityReplayResistance: rate(
      sum((x) => x.replayBlocked),
      sum((x) => x.replayAttempts),
    ),
    approvalBypassResistance: rate(
      sum((x) => x.approvalBypassBlocked),
      sum((x) => x.approvalBypassAttempts),
    ),
    decisionLatencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      samples: latencies.length,
    },
    timeToDetectionMs: { median: percentile(firstBlocks, 0.5), samples: firstBlocks.length },
    controlCoverage: {
      controlsExercised: controls,
      controlsAvailable: CONTROL_COUNT,
      scenarioCategories: categoriesInLibrary,
    },
    regression: {
      total: regressions?.total ?? 0,
      passing: regressions?.passing ?? 0,
      failing: (regressions?.total ?? 0) - (regressions?.passing ?? 0),
    },
    limitations: STANDARD_LIMITATIONS,
  };
}
