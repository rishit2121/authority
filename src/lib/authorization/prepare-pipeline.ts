import type { Policy } from "@/lib/domain";
import type { CandidatePlan } from "@/lib/domain";
import type { LoadedRegistry } from "@/lib/registry";

import { deriveRequiredApprovals } from "./approval-rules";
import { compileContract, type CompiledContract } from "./contract-compiler";
import { verifyCompiledContract, type VerificationResult } from "./contract-verifier";
import type { PlanValidationResult } from "./plan-validator";
import { solveMinimumAuthority, type SolverOutcome } from "./solver";

/**
 * The deterministic core every path that turns a plan into a contract shares -- backend prepare, the dashboard's
 * propose, and the dashboard's activation re-check: minimum-authority solve, compile, required approvals, and the
 * independent verifier. One implementation, so the paths cannot drift apart. Which optional, model-based steps ran
 * before it (task alignment, Jev necessity) is the caller's business; they can only narrow `validation`.
 */
export interface CompileVerifiedContractInput {
  plan: CandidatePlan;
  /** The validation to compile from: the mechanical one, or a narrowing of it (Jev necessity in enforce mode). */
  validation: PlanValidationResult;
  /** True when `validation` may differ from the mechanical one; the verifier then accepts it only as a narrowing. */
  narrowed: boolean;
  registry: LoadedRegistry;
  activePolicies: readonly Policy[];
  tenantId: string;
  taskId: string;
  /** Defaults to this compiler's own version. */
  supportedCompilerVersions?: readonly string[];
  maxAllowedExpirySeconds?: number;
}

export type CompileVerifiedContractResult =
  | {
      ok: true;
      solverOutcome: Extract<SolverOutcome, { status: "solved" }>;
      compiled: CompiledContract;
      requiredApprovalsSpec: ReturnType<typeof deriveRequiredApprovals>;
      verification: VerificationResult;
    }
  | { ok: false; stage: "solver"; reason: string }
  | { ok: false; stage: "verifier"; reason: string; verification: VerificationResult };

export function compileVerifiedContract(input: CompileVerifiedContractInput): CompileVerifiedContractResult {
  const { plan, validation, registry, activePolicies } = input;
  const solverOutcome = solveMinimumAuthority({
    requiredOperations: validation.requiredOperations,
    registry,
    forbiddenPermissionIds: new Set(),
  });
  if (solverOutcome.status !== "solved") {
    return {
      ok: false,
      stage: "solver",
      reason: `The minimum-authority solver could not produce a contract (${solverOutcome.status}).`,
    };
  }

  const compiled = compileContract({ candidatePlan: plan, validation, solverOutcome, registry });
  const requiredApprovalsSpec = deriveRequiredApprovals({
    candidatePlan: plan,
    validation,
    solverOutcome,
    registry,
    activePolicies,
  });
  const verification = verifyCompiledContract({
    candidatePlan: plan,
    registry,
    activePolicies,
    compiled,
    ...(input.narrowed ? { narrowedValidation: validation } : {}),
    tenantId: input.tenantId,
    taskId: input.taskId,
    maxAllowedExpirySeconds: input.maxAllowedExpirySeconds ?? 24 * 3600,
    supportedRegistryVersions: [registry.registryVersion],
    supportedCompilerVersions: input.supportedCompilerVersions ?? [compiled.compilerVersion],
  });
  if (!verification.ok) {
    const firstFailure = verification.checks.find((c) => !c.passed);
    return { ok: false, stage: "verifier", reason: firstFailure?.detail ?? "unknown check", verification };
  }
  return { ok: true, solverOutcome, compiled, requiredApprovalsSpec, verification };
}

export interface ReproduceStoredContractInput extends Omit<
  CompileVerifiedContractInput,
  "validation" | "narrowed"
> {
  /** The plan's mechanical validation under the current registry and policies. */
  mechanicalValidation: PlanValidationResult;
  /** The stored contract's hashes, which the re-compilation must reproduce exactly. */
  stored: { inputHash: string; outputHash: string };
  /** Runs the optional narrowing (Jev necessity) under the tenant's current setting. Called only when needed. */
  narrow: () => Promise<PlanValidationResult>;
}

export type ReproduceStoredContractResult =
  | (Extract<CompileVerifiedContractResult, { ok: true }> & { narrowed: boolean })
  | { ok: false; reason: "stale" | "nothing_left" | "different"; detail?: string }
  | { ok: false; reason: "verification_failed"; detail: string };

/**
 * Re-derives a stored contract before it is activated, accepting it only if the current registry and policies
 * reproduce it exactly. The mechanical compilation is tried first: a contract equal to it carries no narrowing
 * (backend prepare never runs Jev), so it is accepted whatever the tenant's Jev setting is now -- Jev only removes
 * steps, and this contract grants exactly what its plan compiles to. Only otherwise is the narrowing re-run, and the
 * narrowed compilation must then match.
 */
export async function reproduceStoredContract(
  input: ReproduceStoredContractInput,
): Promise<ReproduceStoredContractResult> {
  const { mechanicalValidation, stored, narrow, ...common } = input;
  const matches = (c: CompiledContract) =>
    c.inputHash === stored.inputHash && c.outputHash === stored.outputHash;

  const mechanical = compileVerifiedContract({
    ...common,
    validation: mechanicalValidation,
    narrowed: false,
  });
  if (mechanical.ok && matches(mechanical.compiled)) return { ...mechanical, narrowed: false };

  const validation = await narrow();
  if (validation.includedNodeIds.length === 0) return { ok: false, reason: "nothing_left" };
  const narrowedCore = compileVerifiedContract({ ...common, validation, narrowed: true });
  if (!narrowedCore.ok) {
    return narrowedCore.stage === "solver"
      ? { ok: false, reason: "stale" }
      : { ok: false, reason: "verification_failed", detail: narrowedCore.reason };
  }
  if (!matches(narrowedCore.compiled)) return { ok: false, reason: "different" };
  return { ...narrowedCore, narrowed: true };
}
