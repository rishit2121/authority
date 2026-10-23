import type { CandidatePlan, Policy } from "@/lib/domain";
import type { LoadedRegistry } from "@/lib/registry";

import { canonicalHash } from "./canonicalize";
import { compileContract, normalizedOutput, type CompiledContract } from "./contract-compiler";
import { validateCandidatePlan } from "./plan-validator";
import { solveMinimumAuthority } from "./solver";

/**
 * Deterministic consistency verification of a compiled contract.
 *
 * This re-runs the SAME validator, solver and compiler on the same trusted inputs and checks the result, item by
 * item, so a failure names which guarantee broke. Because it shares their code, a mistake common to the compiler
 * and this check passes both: it is a consistency check, not an independent proof of compiler correctness. The
 * mutation tests and the separately specified contract-subset checker in contract-mutation.test.ts are the
 * independent part.
 *
 * What a pass establishes: given the same plan, registry and policies, the contract's content is exactly the
 * recompiled content (its `outputHash` matches both its own content and the recompilation), and each field-level
 * check below holds. What it does NOT establish: that the caller ran trusted code, or that a persisted `proposed`
 * row is authoritative -- see `lib/persistence/rpc.ts` for why a `proposed` contract grants no runtime authority.
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
  // Without this, a contract whose content was changed but whose outputHash was not still matched the
  // recompilation below, and fields no itemized check covers (expiry, review-required operations, data-flow
  // bindings) could change unnoticed.
  add(
    "output_hash_matches_content",
    canonicalHash(normalizedOutput(compiled)) === compiled.outputHash,
    "the claimed outputHash must equal the hash of the contract's own normalized content",
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
      "accepted_steps_nonempty",
      validation.includedNodeIds.length > 0,
      "revalidating the plan must leave at least one step to compile",
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

      // A contract may hold several actions for one tool (e.g. "email Alice" and
      // "email Bob"), so each check below pairs an action with the specific
      // recompiled action it corresponds to -- never just "some action for the
      // same tool", which could pass a contract whose per-action constraints
      // or budgets were swapped between two entries.
      const coveredBy = (
        a: (typeof compiled.allowedActions)[number],
        r: (typeof compiled.allowedActions)[number],
      ) =>
        a.tool === r.tool &&
        r.constraints.every((rc) => a.constraints.some((ac) => ac.key === rc.key && ac.equals === rc.equals));

      add(
        "no_unplanned_operation",
        compiled.allowedActions.every((a) => rebuilt!.allowedActions.some((r) => r.tool === a.tool)),
        "every contract operation must be present in the independently recompiled accepted-operation set",
      );

      add(
        "every_accepted_operation_covered",
        rebuilt.allowedActions.every((r) => compiled.allowedActions.some((a) => coveredBy(a, r))),
        "every accepted plan operation must be covered by the contract",
      );

      add(
        "constraints_do_not_broaden",
        // The contract's constraint set must be a superset-or-equal of the
        // independently recomputed one for that same action -- never
        // fewer/looser constraints than what the accepted plan declared.
        compiled.allowedActions.every((a) => rebuilt!.allowedActions.some((r) => coveredBy(a, r))),
        "no contract action's constraints may be looser than what the accepted plan declared",
      );

      add(
        "invocation_budgets_do_not_exceed",
        compiled.allowedActions.every((a) =>
          rebuilt!.allowedActions.some(
            (r) =>
              coveredBy(a, r) &&
              a.maxInvocations !== undefined &&
              r.maxInvocations !== undefined &&
              a.maxInvocations <= r.maxInvocations,
          ),
        ) && compiled.ephemeralLimits.maxToolInvocations <= rebuilt.ephemeralLimits.maxToolInvocations,
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
