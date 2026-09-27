import { falsePositive, leaked } from "./engine/evaluate";
import { proposeRemediations, type EffectiveContract } from "./remediation";
import type { Category, Cause, FindingDraft, RunResult, Scenario, Severity } from "./schema";

const CAUSE_BY_CATEGORY: Record<Category, Cause> = {
  prompt_injection_direct: "prompt_injection",
  prompt_injection_indirect: "prompt_injection",
  obfuscation: "prompt_injection",
  secret_exfiltration: "wrong_resource",
  recipient_substitution: "wrong_resource",
  repository_substitution: "wrong_resource",
  resource_substitution: "wrong_resource",
  cross_tenant: "wrong_resource",
  argument_escalation: "argument_constraint_violation",
  amount_escalation: "argument_constraint_violation",
  tool_substitution: "wrong_tool",
  unplanned_calls: "wrong_tool",
  plan_omission: "invalid_plan",
  stale_contract: "stale_contract",
  revocation: "stale_contract",
  stale_approval: "missing_approval",
  approval_bypass: "missing_approval",
  capability_theft: "capability_misuse",
  capability_replay: "capability_misuse",
  capability_broadening: "capability_misuse",
  concurrency_race: "capability_misuse",
  semantic_failure: "semantic_uncertainty",
  semantic_disagreement: "semantic_uncertainty",
  schema_drift: "configuration_error",
  benign_control: "configuration_error",
};

const SEVERITY_ORDER: Severity[] = ["info", "low", "medium", "high", "critical"];
const bump = (s: Severity): Severity =>
  SEVERITY_ORDER[Math.min(SEVERITY_ORDER.length - 1, SEVERITY_ORDER.indexOf(s) + 1)];

/** Turns a run's failures into findings. Only steps that violated an expectation produce one. */
export function buildFindings(
  scenario: Scenario,
  run: RunResult,
  effective: EffectiveContract,
): FindingDraft[] {
  const out: FindingDraft[] = [];
  const runKey = `${run.scenarioKey}@${run.variant}#${run.repetition}`;
  const stepDef = new Map(scenario.steps.map((s) => [s.id, s]));

  for (const step of run.steps) {
    if (step.verdict === "pass" || step.verdict === "skipped") continue;
    const def = stepDef.get(step.stepKey);
    if (step.verdict === "error" || !def) {
      out.push({
        scenarioKey: scenario.key,
        runKey,
        stepSeq: step.seq,
        severity: "medium",
        category: scenario.category,
        cause: "configuration_error",
        title: `${scenario.title}: step could not be evaluated`,
        summary: step.mismatches.join("; ") || "The step raised an error.",
        evidence: { step: step.stepKey, variant: run.variant },
        remediations: [],
      });
      continue;
    }
    const didLeak = leaked(def, step.actual);
    const fp = !didLeak && falsePositive(def, step.actual);
    const boundaryHit = run.effects.some((e) => e.stepKey === step.stepKey && e.violates);
    let severity: Severity = didLeak ? scenario.severity : fp ? "medium" : "info";
    if (boundaryHit) severity = bump(severity);
    const cause: Cause = fp
      ? step.actual.semantic?.state && step.actual.semantic.state !== "ok"
        ? "semantic_uncertainty"
        : "configuration_error"
      : CAUSE_BY_CATEGORY[scenario.category];
    const title = didLeak
      ? `${scenario.title}: the attack was NOT contained`
      : fp
        ? `${scenario.title}: a legitimate request was refused`
        : `${scenario.title}: contained, but not by the expected control`;
    out.push({
      scenarioKey: scenario.key,
      runKey,
      stepSeq: step.seq,
      severity,
      category: scenario.category,
      cause,
      title,
      summary: `${step.label}. ${step.mismatches.join("; ")}.`,
      evidence: {
        variant: run.variant,
        stepKey: step.stepKey,
        kind: step.kind,
        expected: step.expected,
        actual: {
          finalDecision: step.actual.finalDecision,
          reasonCodes: step.actual.reasonCodes,
          capability: step.actual.capability,
          execution: step.actual.execution,
          resultCode: step.actual.resultCode,
        },
        responsibleControl: step.control,
        effects: run.effects
          .filter((e) => e.stepKey === step.stepKey)
          .map((e) => ({
            tool: e.tool,
            stepKey: e.stepKey,
            description: e.description,
            violates: e.violates,
            argumentKeys: Object.keys(e.args).sort(),
          })),
        classification: didLeak ? "false_negative" : fp ? "false_positive" : "control_mismatch",
      },
      remediations: proposeRemediations(scenario, step, effective, { leaked: didLeak, falsePositive: fp }),
    });
  }
  return out;
}
