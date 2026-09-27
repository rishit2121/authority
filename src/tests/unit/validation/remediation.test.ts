import { describe, expect, it } from "vitest";

import { buildFindings } from "@/lib/validation/findings";
import { buildRegressionScenario, mergePatches } from "@/lib/validation/regression";
import { proposeRemediations, type EffectiveContract } from "@/lib/validation/remediation";
import { SCENARIO_BY_KEY } from "@/lib/validation/library";
import { emptyMetrics } from "@/lib/validation/metrics";
import {
  isNarrowingPatch,
  remediationProposalSchema,
  type ConfigPatch,
  type RunResult,
  type StepResult,
} from "@/lib/validation/schema";

const effective: EffectiveContract = {
  allowedActions: [{ tool: "gmail.send_email", constraints: [], maxInvocations: 1 }],
  forbiddenResources: [],
  approvalClasses: ["high"],
  semanticMode: "off",
  requiredClasses: [],
  capabilityTtlSeconds: 60,
};

const failingStep = (over: Partial<StepResult> = {}): StepResult => ({
  seq: 1,
  stepKey: "step-1",
  kind: "attack",
  action: "authorize_execute",
  label: "Lookalike domain",
  request: { tool: "gmail.send_email", argumentValues: { to: "maya@example.com.evil.example" } },
  expected: { decision: ["deny"], execution: "blocked" },
  actual: {
    finalDecision: "allow_constrained",
    reasonCodes: [],
    capability: "issued",
    execution: "executed",
  },
  verdict: "fail",
  control: "none",
  mismatches: ["decision: expected deny, got allow_constrained"],
  latencyMs: 3,
  occurredAt: new Date(0).toISOString(),
  evidence: null,
  ...over,
});

describe("isNarrowingPatch", () => {
  const empty: ConfigPatch = { contractTransforms: [], forbiddenResources: [], forbiddenOperations: [] };
  it("accepts patches that only remove authority", () => {
    expect(
      isNarrowingPatch({
        ...empty,
        contractTransforms: [{ op: "add_constraint", tool: "t", key: "k", equals: "v" }],
      }),
    ).toBe(true);
    expect(isNarrowingPatch({ ...empty, forbiddenResources: ["*.env"] })).toBe(true);
    expect(isNarrowingPatch({ ...empty, capabilityTtlSeconds: 30 }, { ttl: 60 })).toBe(true);
  });
  it("rejects anything that widens", () => {
    expect(
      isNarrowingPatch({ ...empty, contractTransforms: [{ op: "remove_constraint", tool: "t", key: "k" }] }),
    ).toBe(false);
    expect(
      isNarrowingPatch({
        ...empty,
        contractTransforms: [{ op: "increase_invocations", tool: "t", max: 9 }],
      } as ConfigPatch),
    ).toBe(false);
    expect(isNarrowingPatch({ ...empty, approvalClasses: [] }, { approvalClasses: ["high"] })).toBe(false);
    expect(isNarrowingPatch({ ...empty, semantic: { mode: "off" } }, { semanticMode: "enforce" })).toBe(
      false,
    );
    expect(
      isNarrowingPatch({ ...empty, semantic: { requiredClasses: [] } }, { requiredClasses: ["high"] }),
    ).toBe(false);
    expect(isNarrowingPatch({ ...empty, capabilityTtlSeconds: 600 }, { ttl: 60 })).toBe(false);
  });
});

describe("proposeRemediations", () => {
  const scenario = SCENARIO_BY_KEY.get("recipient-substitution")!;

  it("proposes pinning the recipient to the value in the plan, as a narrowing patch", () => {
    const proposals = proposeRemediations(scenario, failingStep(), effective, {
      leaked: true,
      falsePositive: false,
    });
    const pin = proposals.find((p) => p.kind === "narrow_resource_binding");
    expect(pin?.patch?.contractTransforms[0]).toMatchObject({
      op: "add_constraint",
      tool: "gmail.send_email",
      key: "to",
      equals: "maya@example.com",
    });
    expect(pin?.humanSteps.length).toBeGreaterThan(0);
    expect(pin?.agentGuidance).toBeTruthy();
  });

  it("every proposal is human-reviewed, never broadens, and validates against the stored schema", () => {
    for (const key of [
      "recipient-substitution",
      "refund-amount-escalation",
      "secret-exfil-tools-and-files",
      "unplanned-extra-calls",
    ]) {
      const sc = SCENARIO_BY_KEY.get(key)!;
      const tool = sc.plan[0].tool;
      const step = failingStep({
        request: { tool, argumentValues: { ...sc.plan[0].arguments, extra: "x" } },
      });
      for (const p of proposeRemediations(
        sc,
        step,
        { ...effective, allowedActions: [{ tool, constraints: [] }] },
        { leaked: true, falsePositive: false },
      )) {
        expect(p.broadensAuthority).toBe(false);
        expect(p.requiresHumanReview).toBe(true);
        expect(remediationProposalSchema.safeParse(p).success, `${key}:${p.kind}`).toBe(true);
        if (p.patch) expect(isNarrowingPatch(p.patch), `${key}:${p.kind}`).toBe(true);
      }
    }
  });

  it("does not propose anything for a step that was correctly contained", () => {
    expect(
      proposeRemediations(scenario, failingStep(), effective, { leaked: false, falsePositive: false }),
    ).toEqual([]);
  });

  it("for a refused legitimate request, helps the agent recover and never widens authority", () => {
    const proposals = proposeRemediations(scenario, failingStep({ kind: "baseline" }), effective, {
      leaked: false,
      falsePositive: true,
    });
    expect(proposals.map((p) => p.kind)).toEqual(
      expect.arrayContaining(["replan_with_allowed_operation", "ask_user_clarification"]),
    );
    expect(proposals.every((p) => p.patch === null)).toBe(true);
  });
});

describe("findings", () => {
  const scenario = SCENARIO_BY_KEY.get("recipient-substitution")!;
  const attackStep = scenario.steps.find((s) => s.kind === "attack")!;
  const result = (step: StepResult): RunResult => ({
    scenarioKey: scenario.key,
    scenarioVersion: 1,
    variant: "unpinned-recipient",
    repetition: 1,
    seed: 1,
    status: "completed",
    verdict: "fail",
    steps: [step],
    effects: [
      {
        tool: "gmail.send_email",
        stepKey: attackStep.id,
        description: "gmail.send_email executed",
        args: { to: "secret@evil.example" },
        violates: "wrong recipient",
      },
    ],
    metrics: emptyMetrics(),
    durationMs: 1,
  });

  it("classifies a leak as a false negative, bumps severity when the side-effect boundary is hit, and stores no raw argument values", () => {
    const step = failingStep({ stepKey: attackStep.id });
    const [f] = buildFindings(scenario, result(step), effective);
    expect(f.evidence.classification).toBe("false_negative");
    expect(["high", "critical"]).toContain(f.severity);
    expect(f.cause).toBe("wrong_resource");
    expect(JSON.stringify(f)).not.toContain("evil.example");
  });

  it("emits nothing for passing steps", () => {
    expect(
      buildFindings(
        scenario,
        result(failingStep({ stepKey: attackStep.id, verdict: "pass", mismatches: [] })),
        effective,
      ),
    ).toEqual([]);
  });
});

describe("regression tests from accepted remediations", () => {
  const scenario = SCENARIO_BY_KEY.get("recipient-substitution")!;
  const proposal = proposeRemediations(scenario, failingStep(), effective, {
    leaked: true,
    falsePositive: false,
  }).find((p) => p.kind === "narrow_resource_binding")!;
  const id = "abcdef12-3456-4789-8abc-def012345678";

  it("pins the same attack under the failing configuration PLUS the fix, as a new immutable definition", () => {
    const reg = buildRegressionScenario(scenario, "unpinned-recipient", proposal, id);
    expect(reg.key).toBe("regression.recipient-substitution.abcdef12");
    expect(reg.variants).toEqual([]);
    expect(reg.steps).toEqual(scenario.steps); // the attack is unchanged
    expect(reg.appliedPatch?.contractTransforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "add_constraint", key: "to" }),
        ...((scenario.variants.find((v) => v.label === "unpinned-recipient")?.patch.contractTransforms ??
          []) as never[]),
      ]),
    );
    expect(reg.tags).toContain("regression");
    expect(scenario.key).toBe("recipient-substitution"); // the source scenario is not mutated
  });

  it("mergePatches accumulates deny-lists, de-duplicates, and lets later scalars win", () => {
    const a: ConfigPatch = {
      contractTransforms: [],
      forbiddenResources: ["a", "b"],
      forbiddenOperations: [],
      capabilityTtlSeconds: 60,
    };
    const b: ConfigPatch = {
      contractTransforms: [],
      forbiddenResources: ["b", "c"],
      forbiddenOperations: ["x"],
      capabilityTtlSeconds: 30,
    };
    expect(mergePatches(a, null, b)).toEqual({
      contractTransforms: [],
      forbiddenResources: ["a", "b", "c"],
      forbiddenOperations: ["x"],
      capabilityTtlSeconds: 30,
    });
  });
});
