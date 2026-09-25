import { describe, expect, it } from "vitest";

import { loadRegistry } from "@/lib/registry";
import { githubDemoRegistry } from "@/lib/registry/fixtures/github-demo";

import { solveMinimumAuthority } from "@/lib/authorization/solver";

/**
 * Deliberately decoupled from the production `MAX_RELEVANT_PERMISSIONS`:
 * this property suite needs registries small enough for genuine 2^N
 * brute-force enumeration to stay fast across hundreds of generated cases,
 * which is a much tighter bound than the solver's own configured limit.
 * Correctness exactly at the production limit is covered separately by
 * solver-benchmark.test.ts, which runs the real (non-oracle) solver there.
 */
const MAX_GENERATED_PERMISSIONS = 14;

import {
  bruteForceMinimumAuthority,
  generateRandomRegistry,
  mulberry32,
  toRegistryData,
} from "./solver-oracle";

/**
 * Property tests: the real branch-and-bound solver must agree with a
 * genuinely independent, exhaustive brute-force implementation on both the
 * selected permission set *and* the complete score — not merely that both
 * cover the required operations — across many deterministically generated
 * small registries. Every generated registry is guaranteed loadable
 * (`loadRegistry` would otherwise reject it), so a mismatch here can only
 * mean the branch-and-bound's pruning or forced-selection logic is unsound.
 */
describe("solveMinimumAuthority vs. brute-force oracle", () => {
  const CASES = 200;

  for (let seed = 0; seed < CASES; seed++) {
    it(`case seed=${seed}: exact selected set and score match brute force`, () => {
      const random = mulberry32(seed);
      const operationCount = 3 + Math.floor(random() * 6); // 3..8
      const permissionCount = 4 + Math.floor(random() * (MAX_GENERATED_PERMISSIONS - 3));
      const generated = generateRandomRegistry(random, operationCount, permissionCount);
      const registryData = toRegistryData(generated);
      const registry = loadRegistry(registryData);

      // A random, non-empty subset of operations as the required set.
      const allOps = [...registry.operations.keys()];
      const requiredCount = 1 + Math.floor(random() * allOps.length);
      const requiredOperations = [...allOps].sort(() => random() - 0.5).slice(0, requiredCount);

      const solverResult = solveMinimumAuthority({
        requiredOperations,
        registry,
        forbiddenPermissionIds: new Set(),
      });
      const oracleResult = bruteForceMinimumAuthority({
        requiredOperations,
        registry,
        forbiddenPermissionIds: new Set(),
      });

      expect(solverResult.status).toBe(oracleResult.status);
      if (solverResult.status === "solved" && oracleResult.status === "solved") {
        expect(solverResult.solution.selectedPermissionIds).toEqual(
          oracleResult.solution.selectedPermissionIds,
        );
        expect(solverResult.solution.score).toEqual(oracleResult.solution.score);
        expect(solverResult.solution.excessOperations).toEqual(oracleResult.solution.excessOperations);
      }
    });
  }

  it("also agrees with the oracle on the audited demo registry for every single-operation and full-coverage query", () => {
    const registry = loadRegistry(githubDemoRegistry);
    const allOps = [...registry.operations.keys()];

    for (const op of allOps) {
      const solverResult = solveMinimumAuthority({
        requiredOperations: [op],
        registry,
        forbiddenPermissionIds: new Set(),
      });
      const oracleResult = bruteForceMinimumAuthority({
        requiredOperations: [op],
        registry,
        forbiddenPermissionIds: new Set(),
      });
      expect(solverResult).toEqual(expect.objectContaining({ status: oracleResult.status }));
      if (solverResult.status === "solved" && oracleResult.status === "solved") {
        expect(solverResult.solution.selectedPermissionIds).toEqual(
          oracleResult.solution.selectedPermissionIds,
        );
        expect(solverResult.solution.score).toEqual(oracleResult.solution.score);
      }
    }

    const solverAll = solveMinimumAuthority({
      requiredOperations: allOps.filter((o) => o !== "github.get_repository_secrets"),
      registry,
      forbiddenPermissionIds: new Set(),
    });
    const oracleAll = bruteForceMinimumAuthority({
      requiredOperations: allOps.filter((o) => o !== "github.get_repository_secrets"),
      registry,
      forbiddenPermissionIds: new Set(),
    });
    expect(solverAll.status).toBe(oracleAll.status);
    if (solverAll.status === "solved" && oracleAll.status === "solved") {
      expect(solverAll.solution.selectedPermissionIds).toEqual(oracleAll.solution.selectedPermissionIds);
      expect(solverAll.solution.score).toEqual(oracleAll.solution.score);
    }
  });
});
