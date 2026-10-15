import { describe, expect, it } from "vitest";

import { evaluateToolRequest } from "@/lib/authorization";
import { compileContract, type CompiledContract } from "@/lib/authorization/contract-compiler";
import { verifyCompiledContract } from "@/lib/authorization/contract-verifier";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import type { CandidatePlan, CandidatePlanNode } from "@/lib/domain";
import { DEMO_TENANT_ID, demoContract, demoTask } from "@/lib/mock";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

/**
 * "Tell #eng and #product the release is at 5pm": one tool, two different
 * pinned channels. Each must become its own allowed action -- see
 * 20261015000001_allowed_action_per_argument_set.sql for the runtime side.
 */

const registry = loadRegistry(githubDemoRegistry);

const post = (id: string, sequence: number, channel: string, maxInvocations = 1): CandidatePlanNode => ({
  id,
  sequence,
  tool: "slack.post_message",
  arguments: { channel, text: "Release at 5pm" },
  resourceBinding: channel,
  dependencies: [],
  declaredOutputs: [],
  dataFlowRefs: [],
  expectedSideEffect: "write_create",
  maxInvocations,
});

function compile(nodes: CandidatePlanNode[]) {
  const plan: CandidatePlan = { schemaVersion: 1, taskId: "task_release", nodes };
  const validation = validateCandidatePlan(plan, { registry, activePolicies: [] });
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
  return { plan, compiled: compileContract({ candidatePlan: plan, validation, solverOutcome, registry }) };
}

const verify = (plan: CandidatePlan, compiled: CompiledContract) =>
  verifyCompiledContract({
    candidatePlan: plan,
    registry,
    activePolicies: [],
    compiled,
    tenantId: "ten_1",
    taskId: "task_release",
    maxAllowedExpirySeconds: 3600,
    supportedRegistryVersions: [registry.registryVersion],
    supportedCompilerVersions: [compiled.compilerVersion],
  });

const channelOf = (a: CompiledContract["allowedActions"][number]) =>
  a.constraints.find((c) => c.key === "channel")?.equals;

describe("one tool, different arguments", () => {
  it("compiles one allowed action per channel, each with its own budget", () => {
    const { compiled } = compile([post("a", 0, "C-eng"), post("b", 1, "C-product")]);
    expect(compiled.allowedActions).toHaveLength(2);
    expect(compiled.allowedActions.map(channelOf)).toEqual(["C-eng", "C-product"]);
    expect(compiled.allowedActions.map((a) => a.maxInvocations)).toEqual([1, 1]);
    expect(compiled.ephemeralLimits.maxToolInvocations).toBe(2);
  });

  it("still merges identical steps into one action with their combined budget", () => {
    const { compiled } = compile([post("a", 0, "C-eng"), post("b", 1, "C-eng", 2)]);
    expect(compiled.allowedActions).toHaveLength(1);
    expect(compiled.allowedActions[0].maxInvocations).toBe(3);
  });

  it("passes independent verification, and fails it when two actions' budgets are swapped onto one channel", () => {
    const { plan, compiled } = compile([post("a", 0, "C-eng", 1), post("b", 1, "C-product", 3)]);
    expect(verify(plan, compiled).ok).toBe(true);
    const tampered: CompiledContract = {
      ...compiled,
      allowedActions: compiled.allowedActions.map((a) => ({
        ...a,
        maxInvocations: channelOf(a) === "C-eng" ? 3 : 1,
      })),
    };
    const result = verify(plan, tampered);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "invocation_budgets_do_not_exceed")?.passed).toBe(false);
  });

  it("fails verification when one channel's action is dropped", () => {
    const { plan, compiled } = compile([post("a", 0, "C-eng"), post("b", 1, "C-product")]);
    const tampered: CompiledContract = { ...compiled, allowedActions: [compiled.allowedActions[1]] };
    expect(
      verify(plan, tampered).checks.find((c) => c.code === "every_accepted_operation_covered")?.passed,
    ).toBe(false);
  });

  it("the TypeScript evaluator allows either planned channel and refuses any other", async () => {
    const { compiled } = compile([post("a", 0, "C-eng"), post("b", 1, "C-product")]);
    const contract = { ...demoContract, forbiddenResources: [], allowedActions: compiled.allowedActions };
    const decide = async (channel: string) =>
      (
        await evaluateToolRequest({
          contract,
          request: {
            id: `req_${channel}`,
            tenantId: DEMO_TENANT_ID,
            taskId: demoTask.id,
            agentId: "agt_release",
            tool: "slack.post_message",
            arguments: { channel, text: "Release at 5pm" },
            requestedAt: new Date("2026-10-15T00:00:00.000Z").toISOString(),
          },
        })
      ).decision.status;
    expect(await decide("C-eng")).toBe("allow_constrained");
    expect(await decide("C-product")).toBe("allow_constrained");
    expect(await decide("C-general")).toBe("deny");
  });
});
