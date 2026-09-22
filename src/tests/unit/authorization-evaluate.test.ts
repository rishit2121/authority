import { describe, expect, it } from "vitest";

import { MockSemanticDecisionProvider, evaluateToolRequest } from "@/lib/authorization";
import type { ToolArguments, ToolRequest } from "@/lib/domain";
import { DEMO_TENANT_ID, demoContract, demoTask } from "@/lib/mock";

function request(tool: string, args: ToolArguments, id = "req_test"): ToolRequest {
  return {
    id,
    tenantId: DEMO_TENANT_ID,
    taskId: demoTask.id,
    agentId: "agt_coding_17",
    tool,
    arguments: args,
    requestedAt: new Date("2026-02-11T09:14:05.000Z").toISOString(),
  };
}

const intent = demoTask.intent;

describe("evaluateToolRequest — deterministic policy", () => {
  it("allows a constrained in-contract request", async () => {
    const { decision } = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.create_branch", { repository: "payments-api", branch: "fix-991" }),
    });

    expect(decision.status).toBe("allow_constrained");
    expect(decision.appliedConstraints.length).toBeGreaterThan(0);
    expect(decision.reasons.map((r) => r.code)).toContain("WITHIN_CONTRACT");
  });

  it("denies repository secrets as a hard policy rule", async () => {
    const { decision } = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.get_repository_secret", {
        repository: "payments-api",
        secret_name: "STRIPE_API_KEY",
      }),
    });

    expect(decision.status).toBe("deny");
    expect(decision.reasons[0].code).toBe("FORBIDDEN_RESOURCE");
    expect(decision.reasons[0].source).toBe("policy");
    expect(decision.appliedConstraints).toEqual([]);
  });

  it("denies pushing to a branch outside the permitted pattern", async () => {
    const { decision } = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.push_commit", { repository: "payments-api", branch: "main" }),
    });

    expect(decision.status).toBe("deny");
    expect(decision.reasons.map((r) => r.code)).toContain("CONSTRAINT_VIOLATION");
  });

  it("asks the agent to replan for a tool outside the contract", async () => {
    const { decision } = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.merge_pull_request", { repository: "payments-api", number: "1203" }),
    });

    // merge_pull_request is also explicitly forbidden, so policy wins first.
    expect(decision.status).toBe("deny");

    const notForbidden = await evaluateToolRequest({
      contract: demoContract,
      request: request("slack.send_message", { channel: "eng" }),
    });
    expect(notForbidden.decision.status).toBe("replan");
    expect(notForbidden.decision.reasons.map((r) => r.code)).toContain("TOOL_NOT_IN_CONTRACT");
  });

  it("asks for clarification when a constrained argument is missing", async () => {
    const { decision } = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.create_branch", {}),
    });

    expect(decision.status).toBe("clarify");
    expect(decision.reasons.map((r) => r.code)).toContain("ARGUMENTS_UNDERSPECIFIED");
  });

  it("denies once the task invocation budget is exhausted", async () => {
    const { decision } = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.read_repository", { repository: "payments-api" }),
      usedInvocations: demoContract.ephemeralLimits.maxToolInvocations,
    });

    expect(decision.status).toBe("deny");
    expect(decision.reasons.map((r) => r.code)).toContain("INVOCATION_LIMIT_REACHED");
  });

  it("replays the whole #991 plan with exactly one denial", async () => {
    const calls: Array<[string, ToolArguments]> = [
      ["github.read_issue", { repository: "payments-api", issue_number: "991" }],
      ["github.read_repository", { repository: "payments-api" }],
      ["github.get_repository_secret", { repository: "payments-api", secret_name: "STRIPE_API_KEY" }],
      ["github.create_branch", { repository: "payments-api", branch: "fix-991" }],
      ["github.push_commit", { repository: "payments-api", branch: "fix-991" }],
      ["github.create_pull_request", { repository: "payments-api", head: "fix-991", base: "main" }],
    ];

    const statuses: string[] = [];
    for (const [tool, args] of calls) {
      const { decision } = await evaluateToolRequest({
        contract: demoContract,
        request: request(tool, args),
      });
      statuses.push(decision.status);
    }

    expect(statuses.filter((s) => s === "deny")).toHaveLength(1);
    expect(statuses[2]).toBe("deny");
    expect(statuses.filter((s) => s === "allow_constrained")).toHaveLength(5);
  });
});

describe("evaluateToolRequest — semantic evidence", () => {
  it("attaches evidence without widening a deterministic deny", async () => {
    const { decision, evidence } = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.get_repository_secret", {
        repository: "payments-api",
        secret_name: "STRIPE_API_KEY",
      }),
      semanticProvider: new MockSemanticDecisionProvider(),
      taskIntent: intent,
    });

    // Hard deny short-circuits before the provider is ever consulted.
    expect(decision.status).toBe("deny");
    expect(evidence).toBeUndefined();
  });

  it("can only narrow, never upgrade, a permitted outcome", async () => {
    const permissive = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.create_branch", { repository: "payments-api", branch: "fix-991" }),
      semanticProvider: new MockSemanticDecisionProvider(),
      taskIntent: intent,
    });

    expect(["allow_constrained", "replan", "require_approval"]).toContain(permissive.decision.status);
    expect(permissive.evidence?.provider).toBe("mock");
    expect(permissive.evidence?.state).toBe("ok");
  });

  it("falls back to deterministic policy when the provider times out", async () => {
    const { decision, evidence } = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.create_branch", { repository: "payments-api", branch: "fix-991" }),
      semanticProvider: new MockSemanticDecisionProvider({ simulate: "timeout" }),
      taskIntent: intent,
    });

    expect(evidence?.state).toBe("timeout");
    expect(decision.status).toBe("allow_constrained");
    expect(decision.reasons.map((r) => r.code)).toContain("SEMANTIC_EVIDENCE_UNAVAILABLE");
  });

  it("does not let a provider error become permission", async () => {
    const { decision, evidence } = await evaluateToolRequest({
      contract: demoContract,
      request: request("slack.send_message", { channel: "eng" }),
      semanticProvider: new MockSemanticDecisionProvider({ simulate: "error" }),
      taskIntent: intent,
    });

    expect(evidence).toBeUndefined();
    expect(decision.status).toBe("replan");
  });

  it("records provider identity and latency on the decision", async () => {
    const { decision } = await evaluateToolRequest({
      contract: demoContract,
      request: request("github.read_issue", { repository: "payments-api", issue_number: "991" }),
      semanticProvider: new MockSemanticDecisionProvider({ latencyMs: 9 }),
      taskIntent: intent,
    });

    expect(decision.semanticEvidence?.provider).toBe("mock");
    expect(decision.semanticEvidence?.latencyMs).toBe(9);
    expect(decision.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("MockSemanticDecisionProvider", () => {
  it("flags an out-of-contract tool as scope expansion", async () => {
    const provider = new MockSemanticDecisionProvider();
    const result = await provider.evaluate({
      taskId: demoTask.id,
      taskIntent: intent,
      tool: "slack.send_message",
      arguments: { channel: "engineering" },
      contractAllowedTools: demoContract.allowedActions.map((a) => a.tool),
      priorPlanTools: [],
    });

    expect(result.scopeExpansionProbability).toBeGreaterThan(0.5);
    expect(result.state).toBe("ok");
  });

  it("returns neutral zeroed probabilities when degraded", async () => {
    const provider = new MockSemanticDecisionProvider({ simulate: "error" });
    const result = await provider.evaluate({
      taskId: demoTask.id,
      taskIntent: intent,
      tool: "github.read_issue",
      arguments: {},
      contractAllowedTools: [],
      priorPlanTools: [],
    });

    expect(result.state).toBe("error");
    expect(result.overallConfidence).toBe(0);
    expect(result.taskRelevanceProbability).toBe(0);
  });
});
