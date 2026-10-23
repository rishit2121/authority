import { describe, expect, it } from "vitest";

import { evaluateToolRequest } from "@/lib/authorization";
import { CompilationError, compileContract } from "@/lib/authorization/contract-compiler";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import type { CandidatePlan, CandidatePlanNode, TaskAuthorityContract, ToolRequest } from "@/lib/domain";
import { demoContract } from "@/lib/mock";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

/**
 * A value bound by data flow ("use the sender of message 18f0 as the recipient") has no runtime provenance check:
 * the compiler records the binding but pins nothing, and the runtime evaluator checks only pinned constraints. So a
 * data-flow-bound recipient, channel, payment id or amount compiled into an action that accepted ANY value.
 * Only fields the registry marks as free text (generated message content) may be filled from an earlier output.
 */

const registry = loadRegistry(githubDemoRegistry);

const node = (
  n: Partial<CandidatePlanNode> & Pick<CandidatePlanNode, "id" | "sequence" | "tool">,
): CandidatePlanNode => ({
  arguments: {},
  dependencies: [],
  declaredOutputs: [],
  dataFlowRefs: [],
  expectedSideEffect: "read",
  maxInvocations: 1,
  ...n,
});

const readMessage = node({
  id: "read",
  sequence: 1,
  tool: "gmail.get_message",
  arguments: { message_id: "18f0probe" },
  resourceBinding: "18f0probe",
  declaredOutputs: ["sender", "body", "amount", "channel"],
});

function prepare(nodes: CandidatePlanNode[]) {
  const plan: CandidatePlan = { schemaVersion: 1, taskId: "task_df", nodes };
  const validation = validateCandidatePlan(plan, { registry, activePolicies: [] });
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
  const compiled = compileContract({ candidatePlan: plan, validation, solverOutcome, registry });
  return { plan, validation, solverOutcome, compiled };
}

function asContract(compiled: ReturnType<typeof prepare>["compiled"]): TaskAuthorityContract {
  return {
    ...demoContract,
    allowedActions: compiled.allowedActions,
    forbiddenResources: compiled.forbiddenResources,
    ephemeralLimits: compiled.ephemeralLimits,
  };
}

async function decide(contract: TaskAuthorityContract, tool: string, args: Record<string, string | number>) {
  const request: ToolRequest = {
    id: "req_df",
    tenantId: contract.tenantId,
    taskId: contract.taskId,
    agentId: "agent_df",
    tool,
    arguments: args,
    requestedAt: new Date().toISOString(),
  } as ToolRequest;
  return (await evaluateToolRequest({ contract, request })).decision.status;
}

const PERMITTED = new Set(["allow", "allow_constrained"]);

describe("data flow into a target or value field is refused", () => {
  it.each([
    {
      name: "email recipient",
      step: node({
        id: "send",
        sequence: 2,
        tool: "gmail.send_email",
        arguments: { subject: "Re: your order" },
        dependencies: ["read"],
        dataFlowRefs: [{ argumentKey: "to", fromNodeId: "read", output: "sender" }],
        expectedSideEffect: "write_create",
      }),
      attack: {
        tool: "gmail.send_email",
        args: { to: "attacker@evil.example", subject: "Re: your order" } as Record<string, string | number>,
      },
      field: "to",
    },
    {
      name: "Slack channel",
      step: node({
        id: "post",
        sequence: 2,
        tool: "slack.post_message",
        arguments: { text: "Order update" },
        dependencies: ["read"],
        dataFlowRefs: [{ argumentKey: "channel", fromNodeId: "read", output: "channel" }],
        expectedSideEffect: "write_create",
      }),
      attack: {
        tool: "slack.post_message",
        args: { channel: "C-ATTACKER", text: "Order update" } as Record<string, string | number>,
      },
      field: "channel",
    },
    {
      name: "refund amount",
      step: node({
        id: "refund",
        sequence: 2,
        tool: "stripe.issue_refund",
        arguments: { payment_id: "pi_123" },
        resourceBinding: "pi_123",
        dependencies: ["read"],
        dataFlowRefs: [{ argumentKey: "amount_cents", fromNodeId: "read", output: "amount" }],
        expectedSideEffect: "write_create",
      }),
      attack: {
        tool: "stripe.issue_refund",
        args: { payment_id: "pi_123", amount_cents: 999999 } as Record<string, string | number>,
      },
      field: "amount_cents",
    },
  ])(
    "$name: the step is not compiled, and an arbitrary value is not authorized",
    async ({ step, attack, field }) => {
      const { validation, compiled } = prepare([readMessage, step]);
      const finding = validation.findings.find((f) => f.nodeId === step.id)!;
      expect(finding.status).toBe("replan");
      expect(finding.reasons.join(" ")).toContain(`"${field}"`);
      expect(validation.includedNodeIds).not.toContain(step.id);
      expect(compiled.allowedActions.map((a) => a.tool)).not.toContain(step.tool);
      expect(PERMITTED.has(await decide(asContract(compiled), attack.tool, attack.args))).toBe(false);
    },
  );

  it("refuses a data-flow reference to an argument the operation does not have", () => {
    const { validation } = prepare([
      readMessage,
      node({
        id: "post",
        sequence: 2,
        tool: "slack.post_message",
        arguments: { channel: "C-ops", text: "x" },
        dependencies: ["read"],
        dataFlowRefs: [{ argumentKey: "thread_owner", fromNodeId: "read", output: "sender" }],
        expectedSideEffect: "write_create",
      }),
    ]);
    expect(validation.findings.find((f) => f.nodeId === "post")?.status).toBe("replan");
  });
});

describe("data flow into free text stays supported, with its target pinned", () => {
  it("compiles a summary posted to a pinned channel; the channel is enforced, the text is not", async () => {
    const { validation, compiled } = prepare([
      readMessage,
      node({
        id: "post",
        sequence: 2,
        tool: "slack.post_message",
        arguments: { channel: "C-ops" },
        dependencies: ["read"],
        dataFlowRefs: [{ argumentKey: "text", fromNodeId: "read", output: "body" }],
        expectedSideEffect: "write_create",
      }),
    ]);
    expect(validation.findings.find((f) => f.nodeId === "post")?.status).toBe("accepted");
    const post = compiled.allowedActions.find((a) => a.tool === "slack.post_message")!;
    expect(post.constraints).toEqual([{ key: "channel", equals: "C-ops" }]);
    expect(compiled.dataFlowBindings).toEqual([{ argumentKey: "text", fromNodeId: "read", output: "body" }]);
    const contract = asContract(compiled);
    expect(
      PERMITTED.has(await decide(contract, "slack.post_message", { channel: "C-ops", text: "any summary" })),
    ).toBe(true);
    expect(
      PERMITTED.has(await decide(contract, "slack.post_message", { channel: "C-other", text: "x" })),
    ).toBe(false);
  });

  it("free-text fields in the registry are plain strings that identify no resource", () => {
    for (const op of registry.operations.values()) {
      for (const field of op.argumentFields.filter((f) => f.freeText)) {
        expect({
          op: op.id,
          field: field.key,
          type: field.type,
          identifiesResource: field.identifiesResource,
        }).toEqual({
          op: op.id,
          field: field.key,
          type: "string",
          identifiesResource: false,
        });
      }
    }
  });
});

describe("the compiler fails closed on its own", () => {
  it("throws if handed a validation that includes a data-flow-bound target field", () => {
    const send = node({
      id: "send",
      sequence: 2,
      tool: "gmail.send_email",
      arguments: { subject: "s" },
      dependencies: ["read"],
      dataFlowRefs: [{ argumentKey: "to", fromNodeId: "read", output: "sender" }],
      expectedSideEffect: "write_create",
    });
    const plan: CandidatePlan = { schemaVersion: 1, taskId: "task_df", nodes: [readMessage, send] };
    const validation = validateCandidatePlan(plan, { registry, activePolicies: [] });
    const forged = {
      ...validation,
      includedNodeIds: ["read", "send"],
      requiredOperations: ["gmail.get_message", "gmail.send_email"],
    };
    const solverOutcome = solveMinimumAuthority({
      requiredOperations: forged.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });
    if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
    expect(() =>
      compileContract({ candidatePlan: plan, validation: forged, solverOutcome, registry }),
    ).toThrow(CompilationError);
  });
});

describe("prepare reports the steps it left out", () => {
  it("names the refused step and the validator's reason", async () => {
    const { excludedStepsOf } = await import("@/lib/gateway/prepare-task");
    const send = node({
      id: "send",
      sequence: 2,
      tool: "gmail.send_email",
      arguments: { subject: "s" },
      dependencies: ["read"],
      dataFlowRefs: [{ argumentKey: "to", fromNodeId: "read", output: "sender" }],
      expectedSideEffect: "write_create",
    });
    const { plan, validation } = prepare([readMessage, send]);
    const excluded = excludedStepsOf(plan, validation);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]).toMatchObject({ nodeId: "send", tool: "gmail.send_email", status: "replan" });
    expect(excluded[0].reasons.join(" ")).toContain('"to"');
  });
});
