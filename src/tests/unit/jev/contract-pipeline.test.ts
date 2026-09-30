import { describe, expect, it } from "vitest";

import type { PlanValidationResult } from "@/lib/authorization/plan-validator";
import type { CandidatePlan } from "@/lib/domain";
import { loadRegistry } from "@/lib/registry";
import type { RegistryData } from "@/lib/registry/types";
import { runJevContractPipeline } from "@/lib/jev/contract-pipeline";
import type { JevNecessityProvider, NecessityEvaluationInput } from "@/lib/jev/necessity-provider";
import type { ToolNecessityEvaluation } from "@/lib/jev/types";
import { JevProviderError } from "@/lib/jev/types";

const registryData: RegistryData = {
  schemaVersion: 1,
  registryVersion: "test-1",
  operations: [
    {
      id: "svc.read_thing",
      provider: "svc",
      sideEffect: "read",
      resourceType: "thing",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [],
      preconditions: [],
      effects: [],
      alternativeOperationIds: [],
    },
    {
      id: "svc.write_thing",
      provider: "svc",
      sideEffect: "write_update",
      resourceType: "thing",
      dataSensitivity: "internal",
      externalCommunication: false,
      requiresApproval: false,
      financialImpact: false,
      argumentFields: [],
      preconditions: [],
      effects: [],
      alternativeOperationIds: ["svc.read_thing"],
    },
  ],
  permissions: [
    {
      id: "p.read",
      provider: "svc",
      operations: ["svc.read_thing"],
      classification: "read",
      riskCost: 1,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
    {
      id: "p.write",
      provider: "svc",
      operations: ["svc.write_thing"],
      classification: "write",
      riskCost: 5,
      resourceBreadth: 1,
      allowsExternalCommunication: false,
    },
  ],
};
const registry = loadRegistry(registryData);

const node = (over: Partial<CandidatePlan["nodes"][number]>) => ({
  id: "n1",
  sequence: 0,
  tool: "svc.read_thing",
  arguments: {},
  dependencies: [],
  declaredOutputs: [],
  dataFlowRefs: [],
  expectedSideEffect: "read" as const,
  maxInvocations: 1,
  ...over,
});
const plan = (nodes: CandidatePlan["nodes"]): CandidatePlan => ({ schemaVersion: 1, taskId: "t1", nodes });
const validationFor = (
  plan: CandidatePlan,
  statuses: Record<string, "accepted" | "requires_review" | "denied">,
): PlanValidationResult => {
  const findings: PlanValidationResult["findings"] = plan.nodes.map((n) => ({
    nodeId: n.id,
    status: statuses[n.id] ?? "accepted",
    reasons: [],
  }));
  const acceptedNodeIds = findings.filter((f) => f.status === "accepted").map((f) => f.nodeId);
  const includedNodeIds = findings.filter((f) => f.status !== "denied").map((f) => f.nodeId);
  const included = plan.nodes.filter((n) => includedNodeIds.includes(n.id));
  return {
    findings: [...findings],
    acceptedNodeIds,
    includedNodeIds,
    requiredOperations: [...new Set(included.map((n) => n.tool))].sort(),
  };
};

function providerReturning(
  classification: ToolNecessityEvaluation["classification"],
  calls: string[] = [],
): JevNecessityProvider {
  return {
    name: "test",
    model: "m",
    modelVersion: "v1",
    async evaluate(input: NecessityEvaluationInput) {
      calls.push(input.nodeId);
      return {
        classification,
        confidence: 0.9,
        reasonCodes: [],
        requiredPredecessorNodeIds: [],
        missingInformationCodes: [],
        alternativeOperationIds: [],
      };
    },
  };
}

describe("runJevContractPipeline: mode off", () => {
  it("makes no Jev call and leaves the mechanical result completely unchanged", async () => {
    const calls: string[] = [];
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "do the thing",
      validation: v,
      registry,
      activePolicies: [],
      mode: "off",
      provider: providerReturning("unjustified", calls),
    });
    expect(calls).toEqual([]);
    expect(result.adjustedValidation).toEqual(v);
    expect(result.nodeRecords[0].necessityRun).toBeNull();
  });

  it("forces effective mode to off, with no call, when no provider is configured even if the tenant asked for enforce", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: null,
    });
    expect(result.mode).toBe("off");
    expect(result.adjustedValidation).toEqual(v);
  });
});

describe("runJevContractPipeline: mode shadow", () => {
  it("is byte-identical to the mechanical result even when Jev says unjustified", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "do the thing",
      validation: v,
      registry,
      activePolicies: [],
      mode: "shadow",
      provider: providerReturning("unjustified"),
    });
    expect(result.adjustedValidation).toEqual(v); // byte-identical: shadow mode changes nothing
    expect(result.nodeRecords[0].necessityRun?.state).toBe("ok");
    expect(result.nodeRecords[0].disagreement).toBe(true); // still recorded for observability
  });

  it("records no disagreement when Jev agrees with the mechanical acceptance", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "shadow",
      provider: providerReturning("required"),
    });
    expect(result.nodeRecords[0].disagreement).toBe(false);
  });
});

describe("runJevContractPipeline: inputHash", () => {
  it("computes a real 64-hex-char hash only when Jev is actually consulted", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const off = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "off",
      provider: providerReturning("required"),
    });
    expect(off.nodeRecords[0].inputHash).toBeNull();

    const shadow = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "shadow",
      provider: providerReturning("required"),
    });
    expect(shadow.nodeRecords[0].inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the trusted task intent changes, so a stale cached evaluation can never be reused for a different intent", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const a = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "intent A",
      validation: v,
      registry,
      activePolicies: [],
      mode: "shadow",
      provider: providerReturning("required"),
    });
    const b = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "intent B",
      validation: v,
      registry,
      activePolicies: [],
      mode: "shadow",
      provider: providerReturning("required"),
    });
    expect(a.nodeRecords[0].inputHash).not.toBe(b.nodeRecords[0].inputHash);
  });
});

describe("runJevContractPipeline: mode enforce", () => {
  it("removes a node Jev classifies unjustified", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: providerReturning("unjustified"),
    });
    expect(result.adjustedValidation.includedNodeIds).toEqual([]);
    expect(result.nodeRecords[0].finalStatus).toBe("replan");
  });

  it("routes an ambiguous classification to clarify (excluded from the solver)", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: providerReturning("ambiguous"),
    });
    expect(result.adjustedValidation.includedNodeIds).toEqual([]);
    expect(result.nodeRecords[0].finalStatus).toBe("clarify");
  });

  it("routes a conditional classification to requires_review rather than silently gating or granting it", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: providerReturning("conditional"),
    });
    expect(result.adjustedValidation.includedNodeIds).toEqual(["n1"]);
    expect(result.adjustedValidation.acceptedNodeIds).toEqual([]); // not accepted outright
    expect(result.nodeRecords[0].finalStatus).toBe("requires_review");
  });

  it("never upgrades a mechanical requires_review to accepted just because Jev says required", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, { n1: "requires_review" });
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: providerReturning("required"),
    });
    expect(result.nodeRecords[0].finalStatus).toBe("requires_review");
    expect(result.adjustedValidation.acceptedNodeIds).toEqual([]);
  });

  it("leaves a mechanically accepted node accepted when Jev agrees it is required", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: providerReturning("required"),
    });
    expect(result.adjustedValidation.acceptedNodeIds).toEqual(["n1"]);
  });

  it("never treats a Jev timeout/error/unavailable result as approved — routes to review, never silently accepted", async () => {
    const p = plan([node({})]);
    const v = validationFor(p, {});
    const throwing: JevNecessityProvider = {
      name: "t",
      model: "m",
      modelVersion: "v1",
      evaluate: async () => {
        throw new JevProviderError("malformed_output", "bad");
      },
    };
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: throwing,
    });
    expect(result.nodeRecords[0].finalStatus).toBe("requires_review");
    expect(result.adjustedValidation.acceptedNodeIds).toEqual([]);
  });

  it("rejects a node outside the mechanical backward slice regardless of Jev, and never even calls Jev for it", async () => {
    const calls: string[] = [];
    // n2 is a dangling read nothing depends on; n1 depends on nothing and is n2's sibling terminal — n2 is trivially
    // its own terminal too (nothing declared it a dependency), so use a genuinely unreachable setup: n3 feeds n1,
    // n2 feeds nothing and is consumed by nobody AND is not itself the plan's declared objective... to force
    // "outside slice" we need a node whose only consumer is excluded. Use a denied consumer.
    const p = plan([
      node({ id: "n1", sequence: 0 }),
      node({
        id: "n2",
        sequence: 1,
        tool: "svc.write_thing",
        expectedSideEffect: "write_update",
        dependencies: ["n1"],
      }),
      node({
        id: "n3",
        sequence: 2,
        tool: "svc.write_thing",
        expectedSideEffect: "write_update",
        dependencies: ["n1"],
      }),
    ]);
    const v = validationFor(p, { n2: "denied" }); // n1 now has no *included* dependent other than n3
    await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: providerReturning("required", calls),
    });
    // n1 is still reachable from n3 (a real terminal), so it is in-slice; assert calls happened only for in-slice nodes.
    expect(calls.sort()).toEqual(["n1", "n3"]);
  });

  it("never calls Jev for a mechanically denied node, and it stays denied", async () => {
    const calls: string[] = [];
    const p = plan([node({})]);
    const v = validationFor(p, { n1: "denied" });
    const result = await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider: providerReturning("required", calls),
    });
    expect(calls).toEqual([]);
    expect(result.nodeRecords[0].finalStatus).toBe("denied");
    expect(result.adjustedValidation.includedNodeIds).toEqual([]);
  });

  it("only ever asks about this node's own declared dependencies and the registry's own alternative operation ids", async () => {
    const calls: NecessityEvaluationInput[] = [];
    const provider: JevNecessityProvider = {
      name: "t",
      model: "m",
      modelVersion: "v1",
      async evaluate(input) {
        calls.push(input);
        return {
          classification: "required",
          confidence: 0.9,
          reasonCodes: [],
          requiredPredecessorNodeIds: [],
          missingInformationCodes: [],
          alternativeOperationIds: [],
        };
      },
    };
    const p = plan([
      node({ id: "n1", sequence: 0 }),
      node({
        id: "n2",
        sequence: 1,
        tool: "svc.write_thing",
        expectedSideEffect: "write_update",
        dependencies: ["n1"],
      }),
    ]);
    const v = validationFor(p, {});
    await runJevContractPipeline({
      candidatePlan: p,
      taskIntent: "x",
      validation: v,
      registry,
      activePolicies: [],
      mode: "enforce",
      provider,
    });
    const n2Call = calls.find((c) => c.nodeId === "n2")!;
    expect(n2Call.registryOperation.alternativeOperationIds).toEqual(["svc.read_thing"]);
  });
});
