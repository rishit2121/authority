import "server-only";

import { canonicalHash } from "@/lib/authorization/canonicalize";
import { compileContract, CompilationError } from "@/lib/authorization/contract-compiler";
import { validateCandidatePlan } from "@/lib/authorization/plan-validator";
import { solveMinimumAuthority } from "@/lib/authorization/solver";
import type { CandidatePlan } from "@/lib/domain";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

import type { EffectiveContract } from "../remediation";
import type { ConfigPatch, ContractTransform, Scenario } from "../schema";

export class ScenarioAuthoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioAuthoringError";
  }
}

export const registry = loadRegistry(githubDemoRegistry);

export interface SeedContract {
  specVersion: string;
  allowedActions: {
    schemaVersion: 1;
    items: Array<{
      tool: string;
      constraints: Array<{ key: string; equals?: string; matches?: string }>;
      maxInvocations?: number;
    }>;
  };
  forbiddenResources: string[];
  forbiddenOperations: string[];
  ephemeralLimits: { schemaVersion: 1; maxToolInvocations: number; expiresInSeconds: number };
  registryVersion: string;
  compilerVersion: string;
  inputHash: string;
  outputHash: string;
  dataFlowBindings: unknown[];
}

function applyTransform(
  actions: SeedContract["allowedActions"]["items"],
  t: ContractTransform,
): SeedContract["allowedActions"]["items"] {
  switch (t.op) {
    case "add_constraint":
      return actions.map((a) =>
        a.tool === t.tool
          ? {
              ...a,
              constraints: [
                ...a.constraints,
                {
                  key: t.key,
                  ...(t.equals !== undefined ? { equals: t.equals } : { matches: t.matches ?? "*" }),
                },
              ],
            }
          : a,
      );
    case "remove_constraint":
      return actions.map((a) =>
        a.tool === t.tool ? { ...a, constraints: a.constraints.filter((c) => c.key !== t.key) } : a,
      );
    case "reduce_invocations":
      return actions.map((a) =>
        a.tool === t.tool ? { ...a, maxInvocations: Math.min(a.maxInvocations ?? t.max, t.max) } : a,
      );
    case "increase_invocations":
      return actions.map((a) =>
        a.tool === t.tool ? { ...a, maxInvocations: Math.max(a.maxInvocations ?? 1, t.max) } : a,
      );
    case "remove_action":
      return actions.filter((a) => a.tool !== t.tool);
  }
}

/**
 * Compiles the scenario's candidate plan with the REAL validator, solver and compiler (so the contract under test is
 * what the product would produce), then applies configuration patches (a scenario variant, then an optional campaign /
 * remediation patch). Returns the contract to seed and the effective configuration for reporting.
 */
export function compileScenarioContract(
  scenario: Scenario,
  taskId: string,
  patches: ConfigPatch[],
): { contract: SeedContract; effective: EffectiveContract } {
  const plan: CandidatePlan = {
    schemaVersion: 1,
    taskId,
    nodes: scenario.plan.map((n, i) => ({
      id: n.id,
      sequence: i,
      tool: n.tool,
      arguments: n.arguments,
      dependencies: [],
      declaredOutputs: [],
      dataFlowRefs: [],
      expectedSideEffect: n.expectedSideEffect,
      maxInvocations: n.maxInvocations,
    })),
  };
  const validation = validateCandidatePlan(plan, { registry, activePolicies: [] });
  const bad = validation.findings.filter(
    (f) => f.status === "denied" || f.status === "clarify" || f.status === "replan",
  );
  if (bad.length > 0)
    throw new ScenarioAuthoringError(
      `plan rejected by the validator: ${bad.map((f) => `${f.nodeId}: ${f.reasons.join(", ")}`).join("; ")}`,
    );
  const solved = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solved.status !== "solved")
    throw new ScenarioAuthoringError(`no minimum-authority solution (${solved.status})`);
  let compiled;
  try {
    compiled = compileContract({ candidatePlan: plan, validation, solverOutcome: solved, registry });
  } catch (e) {
    if (e instanceof CompilationError) throw new ScenarioAuthoringError(e.message);
    throw e;
  }

  let items: SeedContract["allowedActions"]["items"] = compiled.allowedActions.map((a) => ({
    tool: a.tool,
    constraints: a.constraints.map((c) => ({ ...c })),
    maxInvocations: a.maxInvocations,
  }));
  const forbiddenResources = new Set(scenario.environment.forbiddenResources);
  const forbiddenOperations = new Set(compiled.forbiddenOperations);
  let approvalClasses = [...scenario.environment.approvalClasses];
  let semanticMode: string = scenario.environment.semantic.mode;
  let requiredClasses = [...scenario.environment.semantic.requiredClasses];
  let ttl = scenario.environment.capabilityTtlSeconds;

  for (const patch of patches) {
    for (const t of patch.contractTransforms) items = applyTransform(items, t);
    patch.forbiddenResources.forEach((r) => forbiddenResources.add(r));
    patch.forbiddenOperations.forEach((o) => forbiddenOperations.add(o));
    if (patch.approvalClasses) approvalClasses = [...patch.approvalClasses];
    if (patch.semantic?.mode) semanticMode = patch.semantic.mode;
    if (patch.semantic?.requiredClasses) requiredClasses = [...patch.semantic.requiredClasses];
    if (patch.capabilityTtlSeconds) ttl = patch.capabilityTtlSeconds;
  }
  if (items.length === 0) throw new ScenarioAuthoringError("a patch removed every authorized action");

  const total = items.reduce((s, a) => s + (a.maxInvocations ?? 1), 0);
  const contract: SeedContract = {
    specVersion: compiled.specVersion,
    allowedActions: { schemaVersion: 1, items },
    forbiddenResources: [...forbiddenResources],
    forbiddenOperations: [...forbiddenOperations],
    ephemeralLimits: {
      schemaVersion: 1,
      maxToolInvocations: Math.max(total, compiled.ephemeralLimits.maxToolInvocations),
      expiresInSeconds: compiled.ephemeralLimits.expiresInSeconds,
    },
    registryVersion: compiled.registryVersion,
    compilerVersion: compiled.compilerVersion,
    inputHash: compiled.inputHash,
    outputHash: canonicalHash({
      items,
      forbiddenResources: [...forbiddenResources],
      forbiddenOperations: [...forbiddenOperations],
      base: compiled.outputHash,
    }),
    dataFlowBindings: compiled.dataFlowBindings,
  };
  return {
    contract,
    effective: {
      allowedActions: items,
      forbiddenResources: [...forbiddenResources],
      approvalClasses,
      semanticMode,
      requiredClasses,
      capabilityTtlSeconds: ttl,
    },
  };
}
