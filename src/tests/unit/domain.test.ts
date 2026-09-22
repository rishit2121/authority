import { describe, expect, it } from "vitest";

import {
  agentSchema,
  approvalSchema,
  authorizationDecisionSchema,
  capabilitySchema,
  decisionStatusSchema,
  executionEventSchema,
  isPermitted,
  planSchema,
  principalSchema,
  semanticDecisionResultSchema,
  taskAuthorityContractSchema,
  taskSchema,
  tenantSchema,
  toolNameSchema,
  toolRequestSchema,
} from "@/lib/domain";
import {
  demoAgents,
  demoApprovals,
  demoCapabilities,
  demoContract,
  demoDecisions,
  demoEvents,
  demoPlan,
  demoPrincipals,
  demoTask,
  demoTenant,
  demoToolRequests,
} from "@/lib/mock";

describe("domain schemas", () => {
  it("accepts every fixture in the GitHub #991 scenario", () => {
    expect(() => tenantSchema.parse(demoTenant)).not.toThrow();
    demoPrincipals.forEach((p) => expect(() => principalSchema.parse(p)).not.toThrow());
    demoAgents.forEach((a) => expect(() => agentSchema.parse(a)).not.toThrow());
    expect(() => taskSchema.parse(demoTask)).not.toThrow();
    expect(() => taskAuthorityContractSchema.parse(demoContract)).not.toThrow();
    expect(() => planSchema.parse(demoPlan)).not.toThrow();
    demoToolRequests.forEach((r) => expect(() => toolRequestSchema.parse(r)).not.toThrow());
    demoDecisions.forEach((d) => expect(() => authorizationDecisionSchema.parse(d)).not.toThrow());
    demoCapabilities.forEach((c) => expect(() => capabilitySchema.parse(c)).not.toThrow());
    demoApprovals.forEach((a) => expect(() => approvalSchema.parse(a)).not.toThrow());
    demoEvents.forEach((e) => expect(() => executionEventSchema.parse(e)).not.toThrow());
  });

  it("supports exactly the six authorization decision statuses", () => {
    expect(decisionStatusSchema.options).toEqual([
      "allow",
      "allow_constrained",
      "replan",
      "clarify",
      "require_approval",
      "deny",
    ]);
  });

  it("treats only allow and allow_constrained as permitting execution", () => {
    expect(isPermitted("allow")).toBe(true);
    expect(isPermitted("allow_constrained")).toBe(true);
    for (const status of ["replan", "clarify", "require_approval", "deny"] as const) {
      expect(isPermitted(status)).toBe(false);
    }
  });

  it("requires provider-qualified tool names", () => {
    expect(toolNameSchema.safeParse("github.create_branch").success).toBe(true);
    expect(toolNameSchema.safeParse("postgres.query_order").success).toBe(true);
    expect(toolNameSchema.safeParse("createBranch").success).toBe(false);
    expect(toolNameSchema.safeParse("github.Create-Branch").success).toBe(false);
  });

  it("rejects unknown keys so malformed payloads cannot slip through", () => {
    const result = tenantSchema.safeParse({ ...demoTenant, injected: "value" });
    expect(result.success).toBe(false);
  });

  it("rejects a capability without an expiry, since standing access is not representable", () => {
    const { expiresAt: _omitted, ...withoutExpiry } = demoCapabilities[0];
    expect(capabilitySchema.safeParse(withoutExpiry).success).toBe(false);
  });

  it("rejects a capability that has been used more than its maximum", () => {
    const overused = { ...demoCapabilities[0], usedInvocations: 99, maxInvocations: 2 };
    expect(capabilitySchema.safeParse(overused).success).toBe(false);
  });

  it("requires a contract constraint to specify exactly one matcher", () => {
    const both = {
      ...demoContract,
      allowedActions: [
        { tool: "github.read_issue", constraints: [{ key: "repository", equals: "a", matches: "b" }] },
      ],
    };
    expect(taskAuthorityContractSchema.safeParse(both).success).toBe(false);

    const neither = {
      ...demoContract,
      allowedActions: [{ tool: "github.read_issue", constraints: [{ key: "repository" }] }],
    };
    expect(taskAuthorityContractSchema.safeParse(neither).success).toBe(false);
  });

  it("bounds every semantic probability to [0, 1]", () => {
    const base = {
      provider: "mock",
      model: "mock-heuristic",
      modelVersion: "0.1.0",
      taskRelevanceProbability: 0.9,
      resourceRelevanceProbability: 0.9,
      scopeExpansionProbability: 0.1,
      externalDisclosureProbability: 0.1,
      planConsistencyProbability: 0.8,
      semanticRiskProbability: 0.1,
      overallConfidence: 0.6,
      latencyMs: 12,
      state: "ok" as const,
      evaluatedAt: new Date().toISOString(),
    };
    expect(semanticDecisionResultSchema.safeParse(base).success).toBe(true);
    expect(semanticDecisionResultSchema.safeParse({ ...base, semanticRiskProbability: 1.4 }).success).toBe(
      false,
    );
    expect(semanticDecisionResultSchema.safeParse({ ...base, taskRelevanceProbability: -0.1 }).success).toBe(
      false,
    );
  });
});
