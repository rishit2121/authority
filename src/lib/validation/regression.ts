import type { ConfigPatch, RemediationProposal, Scenario } from "./schema";

/** Combines patches in order; later scalar settings win, transforms and deny-lists accumulate. */
export function mergePatches(...patches: Array<ConfigPatch | null | undefined>): ConfigPatch {
  const out: ConfigPatch = { contractTransforms: [], forbiddenResources: [], forbiddenOperations: [] };
  for (const p of patches) {
    if (!p) continue;
    out.contractTransforms.push(...p.contractTransforms);
    out.forbiddenResources.push(...p.forbiddenResources);
    out.forbiddenOperations.push(...p.forbiddenOperations);
    if (p.approvalClasses) out.approvalClasses = [...p.approvalClasses];
    if (p.semantic) out.semantic = { ...out.semantic, ...p.semantic };
    if (p.capabilityTtlSeconds) out.capabilityTtlSeconds = p.capabilityTtlSeconds;
  }
  out.forbiddenResources = [...new Set(out.forbiddenResources)];
  out.forbiddenOperations = [...new Set(out.forbiddenOperations)];
  return out;
}

/**
 * The regression test an accepted remediation generates: the SAME attack, executed under the configuration that
 * failed PLUS the accepted fix (baked in as `appliedPatch`), pinned as an immutable scenario version. If a later change
 * lets the attack through again, this scenario fails.
 */
export function buildRegressionScenario(
  scenario: Scenario,
  failingVariant: string,
  proposal: RemediationProposal,
  remediationId: string,
): Scenario {
  const failing = scenario.variants.find((v) => v.label === failingVariant)?.patch;
  return {
    ...scenario,
    key: `regression.${scenario.key}.${remediationId.replace(/-/g, "").slice(0, 8)}`,
    version: 1,
    title: `Regression: ${scenario.title}`,
    description: `Generated from the accepted remediation "${proposal.title}". The attack below must stay contained under the configuration that previously failed (${failingVariant}) with the accepted fix applied.`,
    variants: [],
    appliedPatch: mergePatches(scenario.appliedPatch, failing, proposal.patch),
    tags: [...new Set([...scenario.tags, "regression"])].slice(0, 8),
  };
}
