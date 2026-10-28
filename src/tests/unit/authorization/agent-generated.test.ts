import { describe, expect, it } from "vitest";

import { evaluateToolRequest } from "@/lib/authorization";
import { canonicalHash } from "@/lib/authorization/canonicalize";
import {
  COMPILER_VERSION,
  CompilationError,
  compileContract,
  type CompiledContract,
} from "@/lib/authorization/contract-compiler";
import { verifyCompiledContract } from "@/lib/authorization/contract-verifier";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import { planStepsFrom } from "@/lib/alignment/service";
import {
  candidatePlanSchema,
  normalizeCandidatePlan,
  type CandidatePlan,
  type CandidatePlanNode,
  type TaskAuthorityContract,
  type ToolRequest,
} from "@/lib/domain";
import { demoContract } from "@/lib/mock";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

/**
 * `agentGenerated`: a plan states which free-text fields the agent writes at run time, without a data-flow reference
 * to a stand-in earlier step. Targets and values stay pinned; generated content is recorded apart from derived values.
 */

const registry = loadRegistry(githubDemoRegistry);

const post = (n: Partial<CandidatePlanNode> = {}): CandidatePlanNode => ({
  id: "post",
  sequence: 1,
  tool: "slack.post_message",
  arguments: { channel: "C-eng" },
  dependencies: [],
  declaredOutputs: [],
  dataFlowRefs: [],
  expectedSideEffect: "write_create",
  maxInvocations: 1,
  ...n,
});

function plan(nodes: CandidatePlanNode[]): CandidatePlan {
  return { schemaVersion: 1, taskId: "task_ag", nodes };
}

function compile(p: CandidatePlan) {
  const validation = validateCandidatePlan(p, { registry, activePolicies: [] });
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
  return { validation, compiled: compileContract({ candidatePlan: p, validation, solverOutcome, registry }) };
}

const statusOf = (p: CandidatePlan, id = "post") =>
  validateCandidatePlan(p, { registry, activePolicies: [] }).findings.find((f) => f.nodeId === id)?.status;

describe("the validator", () => {
  it("accepts a required free-text field the agent writes, with no earlier step", () => {
    expect(statusOf(plan([post({ agentGenerated: ["text"] })]))).toBe("accepted");
  });

  it("still asks for clarification when a required free-text field is neither pinned, derived nor generated", () => {
    expect(statusOf(plan([post()]))).toBe("clarify");
  });

  it.each([
    ["a channel", post({ arguments: {}, resourceBinding: "C-eng", agentGenerated: ["channel"] })],
    [
      "an email recipient",
      post({
        tool: "gmail.send_email",
        arguments: { subject: "Hi" },
        agentGenerated: ["to"],
      }),
    ],
    ["an argument the tool does not have", post({ agentGenerated: ["text", "admin"] })],
    ["a pinned argument", post({ arguments: { channel: "C-eng", text: "Hi" }, agentGenerated: ["text"] })],
  ])("refuses agent-generated %s (replan)", (_label, node) => {
    expect(statusOf(plan([node]))).toBe("replan");
  });

  it("refuses a field that is both taken from an earlier step and agent-generated", () => {
    const read: CandidatePlanNode = {
      id: "read",
      sequence: 0,
      tool: "linear.get_issue",
      arguments: { issue_id: "ENG-1" },
      resourceBinding: "ENG-1",
      dependencies: [],
      declaredOutputs: ["issue"],
      dataFlowRefs: [],
      expectedSideEffect: "read",
      maxInvocations: 1,
    };
    const node = post({
      dataFlowRefs: [{ argumentKey: "text", fromNodeId: "read", output: "issue" }],
      agentGenerated: ["text"],
    });
    expect(statusOf(plan([read, node]))).toBe("replan");
  });

  it("the plan schema refuses duplicate keys", () => {
    const parsed = candidatePlanSchema.safeParse({
      schemaVersion: 1,
      taskId: "t",
      nodes: [{ ...post(), agentGenerated: ["text", "text"] }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("the compiler", () => {
  it("leaves the generated field open, pins the channel, and records the field as generated", async () => {
    const { compiled } = compile(plan([post({ agentGenerated: ["text"] })]));
    const action = compiled.allowedActions.find((a) => a.tool === "slack.post_message")!;
    expect(action.constraints).toEqual([{ key: "channel", equals: "C-eng" }]);
    expect(action.openArguments).toEqual(["text"]);
    expect(action.generatedArguments).toEqual(["text"]);
    expect(compiled.compilerVersion).toBe(COMPILER_VERSION);

    const contract: TaskAuthorityContract = {
      ...demoContract,
      allowedActions: compiled.allowedActions,
      forbiddenResources: compiled.forbiddenResources,
      ephemeralLimits: compiled.ephemeralLimits,
    };
    const decide = async (args: Record<string, string>) =>
      (
        await evaluateToolRequest({
          contract,
          request: {
            id: "r",
            tenantId: contract.tenantId,
            taskId: contract.taskId,
            agentId: "a",
            tool: "slack.post_message",
            arguments: args,
            requestedAt: new Date().toISOString(),
          } as ToolRequest,
        })
      ).decision.status;
    expect(["allow", "allow_constrained"]).toContain(
      await decide({ channel: "C-eng", text: "anything at all" }),
    );
    expect(await decide({ channel: "C-general", text: "x" })).toBe("deny");
  });

  it("keeps the action identity (constraints) of an equivalent plan unchanged", () => {
    const withMarker = compile(plan([post({ agentGenerated: ["text"] })])).compiled.allowedActions[0];
    const viaDataFlow = compile(
      plan([
        {
          id: "read",
          sequence: 0,
          tool: "linear.get_issue",
          arguments: { issue_id: "ENG-1" },
          resourceBinding: "ENG-1",
          dependencies: [],
          declaredOutputs: ["issue"],
          dataFlowRefs: [],
          expectedSideEffect: "read",
          maxInvocations: 1,
        },
        post({ dataFlowRefs: [{ argumentKey: "text", fromNodeId: "read", output: "issue" }] }),
      ]),
    ).compiled.allowedActions.find((a) => a.tool === "slack.post_message")!;
    expect(withMarker.constraints).toEqual(viaDataFlow.constraints);
    expect(viaDataFlow.generatedArguments).toBeUndefined();
  });

  it("refuses to compile a forged validation that lets a channel be agent-generated", () => {
    const p = plan([post({ arguments: {}, resourceBinding: "C-eng", agentGenerated: ["channel"] })]);
    const forged = {
      ...validateCandidatePlan(p, { registry, activePolicies: [] }),
      includedNodeIds: ["post"],
      requiredOperations: ["slack.post_message"],
    };
    const solverOutcome = solveMinimumAuthority({
      requiredOperations: ["slack.post_message"],
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
    expect(() => compileContract({ candidatePlan: p, validation: forged, solverOutcome, registry })).toThrow(
      CompilationError,
    );
  });
});

describe("the verifier", () => {
  const verify = (p: CandidatePlan, compiled: CompiledContract) =>
    verifyCompiledContract({
      candidatePlan: p,
      registry,
      activePolicies: [],
      compiled,
      tenantId: "tenant",
      taskId: p.taskId,
      maxAllowedExpirySeconds: 86_400,
      supportedRegistryVersions: [registry.registryVersion],
      supportedCompilerVersions: [COMPILER_VERSION],
    });

  it("passes the compiled contract", () => {
    const p = plan([post({ agentGenerated: ["text"] })]);
    const result = verify(p, compile(p).compiled);
    expect(result.checks.find((c) => c.code === "generated_arguments_are_free_text")?.passed).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("fails a contract that claims a pinned target is agent-generated", () => {
    const p = plan([post({ agentGenerated: ["text"] })]);
    const { compiled } = compile(p);
    const tampered: CompiledContract = {
      ...compiled,
      allowedActions: compiled.allowedActions.map((a) => ({ ...a, generatedArguments: ["channel", "text"] })),
    };
    const result = verify(p, tampered);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.code === "generated_arguments_are_free_text")?.passed).toBe(false);
  });
});

describe("hash stability and labelling", () => {
  it("an empty list is the same plan as no list", () => {
    const explicit = normalizeCandidatePlan(plan([post({ agentGenerated: [] })]));
    const absent = normalizeCandidatePlan(plan([post()]));
    expect(canonicalHash(explicit)).toBe(canonicalHash(absent));
  });

  it("alignment sees which arguments the agent writes, apart from derived values", () => {
    const steps = planStepsFrom(plan([post({ agentGenerated: ["text"] })]), ["post"], registry);
    expect(steps[0].generatedKeys).toEqual(["text"]);
    expect(steps[0].derivedKeys).toEqual([]);
  });
});
