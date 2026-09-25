import { describe, expect, it } from "vitest";

import { candidatePlanSchema } from "@/lib/domain";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

import { buildTrustedTaskInput } from "@/lib/ai/build-trusted-task-input";
import { MockPlanProposalProvider } from "@/lib/ai/mock-plan-proposal-provider";

const registry = loadRegistry(githubDemoRegistry);

describe("MockPlanProposalProvider", () => {
  it("produces a plan that passes candidatePlanSchema by default", async () => {
    const input = buildTrustedTaskInput({
      taskId: "task_1",
      taskIntent: "Resolve issue #991",
      registry,
      activePolicies: [],
      resourceReferences: ["payments-api"],
    });
    const provider = new MockPlanProposalProvider();
    const result = await provider.proposePlan(input);
    const parsed = candidatePlanSchema.safeParse(result.plan);
    expect(parsed.success).toBe(true);
    expect(result.metadata.provider).toBe("mock");
  });

  it("never references a tool outside availableTools", async () => {
    const input = buildTrustedTaskInput({
      taskId: "task_1",
      taskIntent: "anything",
      registry,
      activePolicies: [],
      resourceReferences: [],
    });
    const provider = new MockPlanProposalProvider();
    const result = await provider.proposePlan(input);
    const parsed = candidatePlanSchema.parse(result.plan);
    const availableIds = new Set(input.availableTools.map((t) => t.id));
    for (const node of parsed.nodes) {
      expect(availableIds.has(node.tool)).toBe(true);
    }
  });

  it("supports full injection of a custom (including malformed) response for testing", async () => {
    const provider = new MockPlanProposalProvider(() => ({
      plan: { not: "a valid plan" },
      metadata: { provider: "mock", model: "custom", providerVersion: "test" },
    }));
    const result = await provider.proposePlan({
      taskId: "t",
      taskIntent: "x",
      availableTools: [],
      policySummaries: [],
      resourceReferences: [],
    });
    expect(candidatePlanSchema.safeParse(result.plan).success).toBe(false);
  });
});
