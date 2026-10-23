import { describe, expect, it } from "vitest";

import { compileContract } from "@/lib/authorization/contract-compiler";
import { verifyCompiledContract } from "@/lib/authorization/contract-verifier";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import type { CandidatePlan, CandidatePlanNode } from "@/lib/domain";
import { runJevContractPipeline } from "@/lib/jev/contract-pipeline";
import type { JevNecessityProvider, NecessityEvaluationInput } from "@/lib/jev/necessity-provider";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

/**
 * The dashboard's propose path (app/app/tasks/[taskId]/contract/actions.ts) compiles from Jev's ADJUSTED
 * validation, then verifies with verifyCompiledContract, which re-derives from a fresh MECHANICAL validation.
 * This reproduces that sequence to establish what happens when Jev enforce mode narrows a plan.
 */

const registry = loadRegistry(githubDemoRegistry);
const step = (id: string, sequence: number, channel: string): CandidatePlanNode => ({
  id,
  sequence,
  tool: "slack.post_message",
  arguments: { channel, text: "Release at 5pm" },
  dependencies: [],
  declaredOutputs: [],
  dataFlowRefs: [],
  expectedSideEffect: "write_create",
  maxInvocations: 1,
});

const unjustifiedFor = (nodeId: string): JevNecessityProvider => ({
  name: "test",
  model: "m",
  modelVersion: "v1",
  async evaluate(input: NecessityEvaluationInput) {
    return {
      classification: input.nodeId === nodeId ? "unjustified" : "required",
      confidence: 0.9,
      reasonCodes: [],
      requiredPredecessorNodeIds: [],
      missingInformationCodes: [],
      alternativeOperationIds: [],
    };
  },
});

describe("dashboard propose with Jev enforce narrowing a plan", () => {
  it("verifies a contract Jev narrowed, given the adjusted validation", async () => {
    const plan: CandidatePlan = {
      schemaVersion: 1,
      taskId: "t1",
      nodes: [step("eng", 1, "C-eng"), step("extra", 2, "C-random")],
    };
    const mechanical = validateCandidatePlan(plan, { registry, activePolicies: [] });
    const jev = await runJevContractPipeline({
      candidatePlan: plan,
      taskIntent: "Tell #eng the release is at 5pm",
      validation: mechanical,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: unjustifiedFor("extra"),
    });
    expect(jev.adjustedValidation.includedNodeIds).toEqual(["eng"]);

    const validation = jev.adjustedValidation;
    const solverOutcome = solveMinimumAuthority({
      requiredOperations: validation.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
    const compiled = compileContract({ candidatePlan: plan, validation, solverOutcome, registry });
    const verification = verifyCompiledContract({
      candidatePlan: plan,
      registry,
      activePolicies: [],
      compiled,
      tenantId: "ten",
      taskId: "t1",
      maxAllowedExpirySeconds: 24 * 3600,
      supportedRegistryVersions: [registry.registryVersion],
      supportedCompilerVersions: [compiled.compilerVersion],
      narrowedValidation: validation,
    });
    expect(verification.checks.filter((c) => !c.passed)).toEqual([]);
    expect(verification.ok).toBe(true);
    expect(
      compiled.allowedActions.map((a) => a.constraints.find((c) => c.key === "channel")?.equals),
    ).toEqual(["C-eng"]);
  });

  it("rejects an 'adjusted' validation that adds back a step the mechanical validation excluded", async () => {
    const plan: CandidatePlan = {
      schemaVersion: 1,
      taskId: "t1",
      nodes: [step("eng", 1, "C-eng"), { ...step("bad", 2, "C-x"), tool: "slack.unknown_op" }],
    };
    const mechanical = validateCandidatePlan(plan, { registry, activePolicies: [] });
    expect(mechanical.includedNodeIds).toEqual(["eng"]);
    const widened = {
      ...mechanical,
      includedNodeIds: ["eng", "bad"],
      requiredOperations: [...mechanical.requiredOperations, "slack.unknown_op"],
    };
    const solverOutcome = solveMinimumAuthority({
      requiredOperations: mechanical.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
    const compiled = compileContract({
      candidatePlan: plan,
      validation: mechanical,
      solverOutcome,
      registry,
    });
    const verification = verifyCompiledContract({
      candidatePlan: plan,
      registry,
      activePolicies: [],
      compiled,
      tenantId: "ten",
      taskId: "t1",
      maxAllowedExpirySeconds: 24 * 3600,
      supportedRegistryVersions: [registry.registryVersion],
      supportedCompilerVersions: [compiled.compilerVersion],
      narrowedValidation: widened,
    });
    expect(verification.ok).toBe(false);
    expect(verification.checks.find((c) => c.code === "narrowed_validation_only_narrows")?.passed).toBe(
      false,
    );
  });
});
