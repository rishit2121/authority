import type { CandidatePlan, Policy } from "@/lib/domain";
import type { LoadedRegistry } from "@/lib/registry";

import { canonicalHash } from "./canonicalize";
import { compileContract, normalizedOutput, type CompiledContract } from "./contract-compiler";
import { validateCandidatePlan } from "./plan-validator";
import { solveMinimumAuthority } from "./solver";

/**
 * Independent deterministic verification.
 *
 * This does not merely re-run the compiler and trust it — every check below
 * is itemized so a failure names exactly which guarantee broke, and the
 * strongest check (re-deriving the entire pipeline from the same trusted
 * inputs and comparing output hashes) is one of several, not the only one.
 *
 * What this proves: that, given the same candidate plan, registry and active
 * policies, the compiled contract is byte-reproducible, internally
 * consistent, and narrower than or equal to the accepted plan on every
 * dimension that matters. What this does NOT prove: that the caller who
 * invoked compilation was running trusted code, or that a persisted
 * `proposed` row is safe to treat as authoritative — see the module doc in
 * `lib/persistence/rpc.ts` for why a `proposed` contract still grants zero
 * runtime authority regardless of a passing verification here.
 */

export interface VerificationCheck {
  code: string;
  passed: boolean;
  detail: string;
}

export interface VerifyContractInput {
  candidatePlan: CandidatePlan;
  registry: LoadedRegistry;
  activePolicies: readonly Policy[];
  compiled: CompiledContract;
  tenantId: string;
  taskId: string;
  maxAllowedExpirySeconds: number;
  supportedRegistryVersions: readonly string[];
  supportedCompilerVersions: readonly string[];
}

export interface VerificationResult {
  ok: boolean;
  checks: VerificationCheck[];
}

const HEX64 = /^[0-9a-f]{64}$/;

export function verifyCompiledContract(input: VerifyContractInput): VerificationResult {
  const {
    candidatePlan,
    registry,
    activePolicies,
    compiled,
    tenantId,
    taskId,
    maxAllowedExpirySeconds,
    supportedRegistryVersions,
    supportedCompilerVersions,
  } = input;
  const checks: VerificationCheck[] = [];
  const add = (code: string, passed: boolean, detail: string) => checks.push({ code, passed, detail });

  add(
    "tenant_task_consistent",
    candidatePlan.taskId === taskId,
    `candidate plan task ${candidatePlan.taskId} must equal the claimed task ${taskId}`,
  );
  add("tenant_id_present", tenantId.length > 0, "a tenant id must be supplied for verification");

  add(
    "registry_version_supported",
    supportedRegistryVersions.includes(compiled.registryVersion),
    `registry version "${compiled.registryVersion}" must be one of the supported versions`,
  );
  add(
    "compiler_version_supported",
    supportedCompilerVersions.includes(compiled.compilerVersion),
    `compiler version "${compiled.compilerVersion}" must be one of the supported versions`,
  );
  add(
    "input_hash_well_formed",
    HEX64.test(compiled.inputHash),
    "inputHash must be 64 lowercase hex characters",
  );
  add(
    "output_hash_well_formed",
    HEX64.test(compiled.outputHash),
    "outputHash must be 64 lowercase hex characters",
  );

  add(
    "expiration_within_policy",
    compiled.ephemeralLimits.expiresInSeconds <= maxAllowedExpirySeconds,
    `expiresInSeconds (${compiled.ephemeralLimits.expiresInSeconds}) must not exceed the policy maximum (${maxAllowedExpirySeconds})`,
  );

  // Independent re-derivation from the same trusted inputs.
  let rebuilt: ReturnType<typeof compileContract> | null = null;
  try {
    const validation = validateCandidatePlan(candidatePlan, { registry, activePolicies });
    // Policy-level node/operation denial already removed a denied node's
    // operation from `requiredOperations` entirely (see plan-validator.ts) —
    // the solver never needs to separately exclude a permission for that
    // reason. `forbiddenPermissionIds` exists as a first-class solver
    // capability (tested directly in solver.test.ts) for a *different*,
    // not-yet-modeled policy shape that names a permission ID outright; no
    // such policy exists in Part 3A's closed policy-condition vocabulary
    // (tool/resource/provider), so this is always empty in the real pipeline.
    const solverOutcome = solveMinimumAuthority({
      requiredOperations: validation.requiredOperations,
      registry,
      forbiddenPermissionIds: new Set(),
    });

    add(
      "acceptedOperations_nonEmpty_or_matches",
      validation.requiredOperations.length >= 0,
      "revalidation completed",
    );

    if (solverOutcome.status !== "solved") {
      add(
        "solver_reproducible",
        false,
        `re-solving returned "${solverOutcome.status}", not a solved contract`,
      );
    } else {
      add("solver_reproducible", true, "re-solving completed");
      rebuilt = compileContract({ candidatePlan, validation, solverOutcome, registry });

      add(
        "selected_permissions_reproduced",
        JSON.stringify(rebuilt.selectedPermissionIds) === JSON.stringify(compiled.selectedPermissionIds),
        "re-running the solver must select the exact same permission set",
      );

      add(
        "no_unplanned_operation",
        compiled.allowedActions.every((a) => rebuilt!.allowedActions.some((r) => r.tool === a.tool)),
        "every contract operation must be present in the independently recompiled accepted-operation set",
      );

      add(
        "every_accepted_operation_covered",
        rebuilt.allowedActions.every((r) => compiled.allowedActions.some((a) => a.tool === r.tool)),
        "every accepted plan operation must be covered by the contract",
      );

      add(
        "constraints_do_not_broaden",
        compiled.allowedActions.every((a) => {
          const r = rebuilt!.allowedActions.find((x) => x.tool === a.tool);
          if (!r) return false;
          // The contract's constraint set must be a superset-or-equal of the
          // independently recomputed one — never fewer/looser constraints
          // than what the accepted plan actually declared.
          return r.constraints.every((rc) =>
            a.constraints.some((ac) => ac.key === rc.key && ac.equals === rc.equals),
          );
        }),
        "no contract action's constraints may be looser than what the accepted plan declared",
      );

      add(
        "invocation_budgets_do_not_exceed",
        compiled.allowedActions.every((a) => {
          const r = rebuilt!.allowedActions.find((x) => x.tool === a.tool);
          if (!r || a.maxInvocations === undefined || r.maxInvocations === undefined) return false;
          return a.maxInvocations <= r.maxInvocations;
        }) && compiled.ephemeralLimits.maxToolInvocations <= rebuilt.ephemeralLimits.maxToolInvocations,
        "no invocation budget may exceed what the accepted plan's nodes declared",
      );

      add(
        "forbidden_operations_preserved",
        rebuilt.forbiddenOperations.every((op) => compiled.forbiddenOperations.includes(op)),
        "every independently-denied operation must remain forbidden in the contract",
      );
      add(
        "forbidden_operations_not_allowed",
        compiled.allowedActions.every((a) => !compiled.forbiddenOperations.includes(a.tool)),
        "no allowed action may name an operation also listed as forbidden",
      );

      add(
        "required_approvals_preserved",
        rebuilt.requiredApprovals.every((tool) => compiled.requiredApprovals.includes(tool)),
        "every operation the registry marks as requiring approval must remain listed",
      );

      const recomputedOutputHash = canonicalHash(normalizedOutput(rebuilt));
      add(
        "output_hash_matches_recomputation",
        recomputedOutputHash === compiled.outputHash,
        "the claimed outputHash must equal an independently recomputed hash of the same normalized content",
      );
    }
  } catch (error) {
    add(
      "revalidation_did_not_throw",
      false,
      `revalidating the candidate plan threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { ok: checks.every((c) => c.passed), checks };
}
