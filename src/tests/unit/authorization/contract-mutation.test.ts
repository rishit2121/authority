import { describe, expect, it } from "vitest";

import { canonicalHash } from "@/lib/authorization/canonicalize";
import {
  compileContract,
  normalizedOutput,
  type CompiledContract,
} from "@/lib/authorization/contract-compiler";
import { verifyCompiledContract } from "@/lib/authorization/contract-verifier";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import type { CandidatePlan, CandidatePlanNode } from "@/lib/domain";
import { githubDemoRegistry, loadRegistry, type RegistryData } from "@/lib/registry";

/**
 * Mutation tests for the contract verifier, plus an independently specified contract-subset checker.
 *
 * The verifier re-runs the same validator, solver and compiler, so it is a consistency check, not an independent
 * proof of compiler correctness. These tests (1) make sure any change to a compiled contract's content is caught,
 * whether or not the mutator also recomputed `outputHash`, and (2) compare the compiler's output with a few-line
 * specification written without reference to the compiler's code.
 */

const registry = loadRegistry(githubDemoRegistry);

const node = (
  n: Partial<CandidatePlanNode> & Pick<CandidatePlanNode, "id" | "sequence" | "tool">,
): CandidatePlanNode => ({
  arguments: {},
  dependencies: [],
  declaredOutputs: [],
  dataFlowRefs: [],
  expectedSideEffect: "write_create",
  maxInvocations: 1,
  ...n,
});

const PLAN: CandidatePlan = {
  schemaVersion: 1,
  taskId: "task_mut",
  nodes: [
    node({
      id: "read",
      sequence: 1,
      tool: "gmail.get_message",
      arguments: { message_id: "m1" },
      resourceBinding: "m1",
      expectedSideEffect: "read",
      declaredOutputs: ["body"],
    }),
    node({
      id: "post",
      sequence: 2,
      tool: "slack.post_message",
      arguments: { channel: "C-ops" },
      dependencies: ["read"],
      dataFlowRefs: [{ argumentKey: "text", fromNodeId: "read", output: "body" }],
      maxInvocations: 2,
    }),
    node({
      id: "mail",
      sequence: 3,
      tool: "gmail.send_email",
      arguments: { to: "alice@example.com", subject: "Status", body: "Done." },
      resourceBinding: "alice@example.com",
    }),
    node({
      id: "refund",
      sequence: 4,
      tool: "stripe.issue_refund",
      arguments: { payment_id: "pi_1", amount_cents: 4900 },
      resourceBinding: "pi_1",
    }),
    // The only registry operation that requires approval, so "drop a required approval" changes real content.
    node({
      id: "secrets",
      sequence: 5,
      tool: "github.get_repository_secrets",
      arguments: { repository: "acme/payments-api" },
      resourceBinding: "acme/payments-api",
      expectedSideEffect: "read",
    }),
  ],
};

function compilePlan(plan: CandidatePlan, reg = registry) {
  const validation = validateCandidatePlan(plan, { registry: reg, activePolicies: [] });
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry: reg,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
  return {
    validation,
    compiled: compileContract({ candidatePlan: plan, validation, solverOutcome, registry: reg }),
  };
}

const verify = (compiled: CompiledContract, plan = PLAN) =>
  verifyCompiledContract({
    candidatePlan: plan,
    registry,
    activePolicies: [],
    compiled,
    tenantId: "ten_1",
    taskId: plan.taskId,
    maxAllowedExpirySeconds: 24 * 3600,
    supportedRegistryVersions: [registry.registryVersion],
    supportedCompilerVersions: [compiled.compilerVersion],
  });

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rehash = (c: CompiledContract): CompiledContract => {
  const { inputHash, outputHash: _drop, ...rest } = c;
  return { ...rest, inputHash, outputHash: canonicalHash(normalizedOutput(rest)) };
};

type Mutation = [string, (c: CompiledContract) => void];
const MUTATIONS: Mutation[] = [
  [
    "change a recipient",
    (c) => {
      const a = c.allowedActions.find((x) => x.tool === "gmail.send_email")!;
      a.constraints = a.constraints.map((k) =>
        k.key === "to" ? { ...k, equals: "attacker@evil.example" } : k,
      );
    },
  ],
  [
    "drop a constraint",
    (c) => {
      const a = c.allowedActions.find((x) => x.tool === "stripe.issue_refund")!;
      a.constraints = a.constraints.filter((k) => k.key !== "amount_cents");
    },
  ],
  [
    "add an action for a new recipient",
    (c) => {
      c.allowedActions.push({
        tool: "gmail.send_email",
        constraints: [{ key: "to", equals: "bob@example.com" }],
        maxInvocations: 1,
      });
    },
  ],
  [
    "raise an action budget",
    (c) => {
      c.allowedActions.find((x) => x.tool === "slack.post_message")!.maxInvocations = 20;
    },
  ],
  [
    "raise the task budget",
    (c) => {
      c.ephemeralLimits.maxToolInvocations += 10;
    },
  ],
  [
    "extend the expiry",
    (c) => {
      c.ephemeralLimits.expiresInSeconds = 24 * 3600;
    },
  ],
  [
    "drop a required approval",
    (c) => {
      c.requiredApprovals = [];
    },
  ],
  [
    "drop a review-required operation",
    (c) => {
      c.reviewRequiredOperations = [];
    },
  ],
  [
    "redirect a data-flow binding",
    (c) => {
      c.dataFlowBindings = [{ argumentKey: "text", fromNodeId: "mail", output: "body" }];
    },
  ],
];

describe("the verifier rejects any change to compiled content", () => {
  const { compiled } = compilePlan(PLAN);

  it("accepts the unmodified contract", () => {
    expect(verify(compiled).ok).toBe(true);
  });

  it.each(MUTATIONS)("rejects: %s (outputHash left as it was)", (_name, mutate) => {
    const m = clone(compiled);
    mutate(m);
    expect(verify(m).ok).toBe(false);
  });

  it.each(MUTATIONS)("rejects: %s (outputHash recomputed by the mutator)", (_name, mutate) => {
    const m = clone(compiled);
    mutate(m);
    expect(verify(rehash(m)).ok).toBe(false);
  });

  it("has no check that can never fail", () => {
    const empty: CandidatePlan = { ...PLAN, nodes: [] } as unknown as CandidatePlan;
    const result = verify(compiled, { ...empty, nodes: [PLAN.nodes[0]] });
    // A contract that does not match the plan it is verified against must fail at least one real check.
    expect(result.ok).toBe(false);
    expect(result.checks.map((c) => c.code)).not.toContain("acceptedOperations_nonEmpty_or_matches");
  });
});

/**
 * Independent specification of the compiled allowed-action set, written without reading the compiler:
 *   for every included step, one action (tool, every concrete argument pinned with `equals` as its canonical text,
 *   budget = the step's maxInvocations); identical (tool, pins) pairs merge with summed budgets; nothing else.
 */
function specifiedActions(plan: CandidatePlan, includedIds: string[]) {
  const merged = new Map<string, { tool: string; pins: Record<string, string>; budget: number }>();
  for (const n of plan.nodes.filter((x) => includedIds.includes(x.id))) {
    const pins: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.arguments)) pins[k] = String(v);
    const key = JSON.stringify([n.tool, Object.entries(pins).sort()]);
    const prev = merged.get(key);
    merged.set(key, { tool: n.tool, pins, budget: (prev?.budget ?? 0) + n.maxInvocations });
  }
  return [...merged.values()]
    .map((a) => JSON.stringify([a.tool, Object.entries(a.pins).sort(), a.budget]))
    .sort();
}

const asSpec = (c: CompiledContract) =>
  c.allowedActions
    .map((a) =>
      JSON.stringify([a.tool, a.constraints.map((k) => [k.key, k.equals]).sort(), a.maxInvocations]),
    )
    .sort();

describe("compiler output matches an independent specification", () => {
  it("on a realistic mixed plan", () => {
    const { validation, compiled } = compilePlan(PLAN);
    expect(asSpec(compiled)).toEqual(specifiedActions(PLAN, validation.includedNodeIds));
  });

  it("on 300 random plans over the registry", () => {
    let seed = 11;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ops = [...registry.operations.values()].filter((o) => !o.externalCommunication);
    const valueFor = (type: string, i: number) =>
      type === "number" ? 100 + i : type === "boolean" ? i % 2 === 0 : `v${i}`;
    for (let trial = 0; trial < 300; trial++) {
      const nodes: CandidatePlanNode[] = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => {
        const op = ops[Math.floor(rand() * ops.length)];
        const args: Record<string, string | number | boolean> = {};
        for (const f of op.argumentFields) {
          if (f.required || f.identifiesResource || rand() < 0.5)
            args[f.key] = valueFor(f.type, Math.floor(rand() * 3)) as never;
        }
        return node({
          id: `n${i}`,
          sequence: i,
          tool: op.id,
          arguments: args,
          expectedSideEffect: op.sideEffect,
          maxInvocations: 1 + Math.floor(rand() * 3),
        });
      });
      const plan: CandidatePlan = { schemaVersion: 1, taskId: `t${trial}`, nodes };
      const validation = validateCandidatePlan(plan, { registry, activePolicies: [] });
      if (validation.includedNodeIds.length === 0) continue;
      const { compiled } = compilePlan(plan);
      expect(asSpec(compiled)).toEqual(specifiedActions(plan, validation.includedNodeIds));
    }
  });
});

describe("argument types the compiler cannot pin fail closed", () => {
  // No registered operation takes a string array today; a future one must not silently compile unconstrained.
  const withArrayOp: RegistryData = {
    ...githubDemoRegistry,
    registryVersion: "test-array",
    operations: [
      ...githubDemoRegistry.operations,
      {
        id: "acme.share_document",
        provider: "acme",
        sideEffect: "write_update",
        resourceType: "document",
        dataSensitivity: "internal",
        requiresApproval: false,
        externalCommunication: false,
        financialImpact: false,
        argumentFields: [
          { key: "document_id", type: "string", required: true, identifiesResource: true },
          { key: "recipients", type: "stringArray", required: true, identifiesResource: false },
        ],
        preconditions: [],
        effects: [],
        alternativeOperationIds: [],
      },
    ],
    permissions: [
      ...githubDemoRegistry.permissions,
      {
        id: "acme.docs_write",
        provider: "acme",
        operations: ["acme.share_document"],
        classification: "write",
        riskCost: 1,
        resourceBreadth: 1,
        allowsExternalCommunication: false,
      },
    ],
  };
  const arrayRegistry = loadRegistry(withArrayOp);

  it("refuses a step that pins a string-array argument rather than compiling it unconstrained", () => {
    const plan: CandidatePlan = {
      schemaVersion: 1,
      taskId: "task_arr",
      nodes: [
        node({
          id: "share",
          sequence: 1,
          tool: "acme.share_document",
          arguments: { document_id: "doc-1", recipients: ["alice@example.com"] },
          resourceBinding: "doc-1",
          expectedSideEffect: "write_update",
        }),
      ],
    };
    const validation = validateCandidatePlan(plan, { registry: arrayRegistry, activePolicies: [] });
    expect(validation.findings[0].status).toBe("replan");
    expect(validation.findings[0].reasons.join(" ")).toContain("recipients");
  });
});
