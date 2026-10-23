import { describe, expect, it } from "vitest";

import { evaluateToolRequest } from "@/lib/authorization";
import { compileContract } from "@/lib/authorization/contract-compiler";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import type { CandidatePlan, CandidatePlanNode, TaskAuthorityContract, ToolRequest } from "@/lib/domain";
import { demoContract } from "@/lib/mock";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

/**
 * An optional argument the plan never set used to be unconstrained at runtime: the evaluator checked only pinned
 * keys, so the agent could add `head_branch`, a mailbox `query`, or any key at all. Each compiled action now lists
 * its open (free-text) arguments, and any other unpinned key is refused. The SQL evaluator's side of this is
 * supabase/tests/26_closed_world_arguments.sql.
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
  maxInvocations: 3,
  ...n,
});

function contractFor(nodes: CandidatePlanNode[]): TaskAuthorityContract {
  const plan: CandidatePlan = { schemaVersion: 1, taskId: "task_cw", nodes };
  const validation = validateCandidatePlan(plan, { registry, activePolicies: [] });
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") throw new Error(solverOutcome.status);
  const compiled = compileContract({ candidatePlan: plan, validation, solverOutcome, registry });
  return {
    ...demoContract,
    allowedActions: compiled.allowedActions,
    ephemeralLimits: compiled.ephemeralLimits,
  };
}

async function decide(contract: TaskAuthorityContract, tool: string, args: Record<string, string | number>) {
  const request = {
    id: "req_cw",
    tenantId: contract.tenantId,
    taskId: contract.taskId,
    agentId: "agent_cw",
    tool,
    arguments: args,
    requestedAt: new Date().toISOString(),
  } as ToolRequest;
  return (await evaluateToolRequest({ contract, request })).decision;
}

const pr = node({
  id: "pr",
  sequence: 1,
  tool: "github.create_pull_request",
  arguments: { repository: "acme/api", target_branch: "main" },
  resourceBinding: "acme/api",
});
const mail = node({
  id: "mail",
  sequence: 2,
  tool: "gmail.send_email",
  arguments: { to: "alice@example.com", subject: "Status" },
  resourceBinding: "alice@example.com",
});
const list = node({ id: "list", sequence: 3, tool: "gmail.list_messages", expectedSideEffect: "read" });

describe("compiled actions declare their open arguments", () => {
  it("lists only free-text fields the action leaves unpinned", () => {
    const contract = contractFor([pr, mail, list]);
    const open = Object.fromEntries(contract.allowedActions.map((a) => [a.tool, a.openArguments]));
    expect(open).toEqual({
      "github.create_pull_request": [],
      "gmail.send_email": ["body"],
      "gmail.list_messages": [],
    });
  });
});

describe("the evaluator refuses unpinned, undeclared argument keys", () => {
  const contract = contractFor([pr, mail, list]);

  it.each([
    [
      "a pull request from a branch the plan never named",
      "github.create_pull_request",
      { repository: "acme/api", target_branch: "main", head_branch: "attacker-branch" },
    ],
    ["a mailbox query the plan never set", "gmail.list_messages", { query: "from:ceo subject:password" }],
    [
      "an extra recipient field",
      "gmail.send_email",
      { to: "alice@example.com", subject: "Status", cc: "attacker@evil.example" },
    ],
  ] as const)("refuses %s", async (_name, tool, args) => {
    const decision = await decide(contract, tool, args);
    expect(decision.status).toBe("deny");
    expect(decision.reasons.map((r) => r.code)).toContain("CONSTRAINT_VIOLATION");
  });

  it.each([
    [
      "the pinned pull request",
      "github.create_pull_request",
      { repository: "acme/api", target_branch: "main" },
    ],
    [
      "an email with a body the agent wrote",
      "gmail.send_email",
      { to: "alice@example.com", subject: "Status", body: "Done." },
    ],
    ["listing with no arguments", "gmail.list_messages", {}],
  ] as const)("still allows %s", async (_name, tool, args) => {
    expect(["allow", "allow_constrained"]).toContain((await decide(contract, tool, args)).status);
  });

  it("asks for clarification only when a pinned argument is missing and nothing undeclared is supplied", async () => {
    expect((await decide(contract, "gmail.send_email", { subject: "Status" })).status).toBe("clarify");
    expect(
      (await decide(contract, "gmail.send_email", { subject: "Status", cc: "x@evil.example" })).status,
    ).toBe("deny");
  });

  it("leaves a legacy action (compiled before openArguments existed) open, as the SQL evaluator does", async () => {
    const legacy: TaskAuthorityContract = {
      ...contract,
      allowedActions: contract.allowedActions.map(({ openArguments: _drop, ...rest }) => rest),
    };
    const args = { repository: "acme/api", target_branch: "main", head_branch: "any" };
    expect((await decide(legacy, "github.create_pull_request", args)).status).toBe("allow_constrained");
  });
});
