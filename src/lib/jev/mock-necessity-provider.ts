import "server-only";

import type { JevNecessityProvider, NecessityEvaluationInput } from "./necessity-provider";
import type { NecessityReasonCode, ToolNecessityEvaluation } from "./types";

export const MOCK_NECESSITY_PROVIDER_VERSION = "authority-mock-jev-necessity-provider-2026-09-29";

/**
 * A deterministic, rule-based stand-in for direct Jev necessity evaluation — for tests and local exploration only.
 * Never selected by the real pipeline when Jev is unconfigured (necessity evaluation is simply skipped in that case,
 * per docs/jev/OVERVIEW.md); this class exists so the composition logic, UI and evaluation harness can be exercised
 * without a live OpenRouter key, and its output is never to be mistaken for a live Jev verification result.
 *
 * Heuristics, all simple and inspectable (not a claim of accuracy — see `docs/jev/OVERVIEW.md`'s evaluation section):
 *  - A node whose tool+resourceType repeats one already in the plan, and that nothing depends on, is `unjustified`
 *    (`duplicate_operation`).
 *  - A node outside the mechanical backward slice with no dependents is `unjustified` (`unrelated_resource`).
 *  - A node with a registry-curated alternative and a `read` side effect elsewhere available is `conditional`.
 *  - Everything else is `required` with low-to-moderate confidence — deliberately not confident, since this is a mock.
 */
export class MockNecessityProvider implements JevNecessityProvider {
  readonly name = "mock";
  readonly model = "mock-necessity-heuristic";
  readonly modelVersion = MOCK_NECESSITY_PROVIDER_VERSION;

  async evaluate(
    input: NecessityEvaluationInput,
    _call: { signal: AbortSignal },
  ): Promise<ToolNecessityEvaluation> {
    const node = input.plan.find((n) => n.id === input.nodeId);
    if (!node) {
      return {
        classification: "ambiguous",
        confidence: 0,
        reasonCodes: [],
        requiredPredecessorNodeIds: [],
        missingInformationCodes: [],
        alternativeOperationIds: [],
      };
    }
    const hasDependent = input.plan.some(
      (n) => n.dependencies.includes(node.id) || n.dataFlowFromNodeIds.includes(node.id),
    );
    const duplicate = input.plan.some(
      (n) => n.id !== node.id && n.tool === node.tool && !hasDependent && n.sideEffect === node.sideEffect,
    );

    const reasonCodes: NecessityReasonCode[] = [];
    let classification: ToolNecessityEvaluation["classification"] = "required";
    let confidence = 0.55;

    if (duplicate) {
      classification = "unjustified";
      reasonCodes.push("duplicate_operation");
      confidence = 0.6;
    } else if (!input.inBackwardSlice && !hasDependent) {
      classification = "unjustified";
      reasonCodes.push("unrelated_resource");
      confidence = 0.55;
    } else if (input.registryOperation.alternativeOperationIds.length > 0) {
      classification = "conditional";
      reasonCodes.push("less_privileged_alternative");
      confidence = 0.5;
    } else {
      reasonCodes.push("direct_task_requirement");
    }

    return {
      classification,
      confidence,
      reasonCodes,
      requiredPredecessorNodeIds: node.dependencies,
      missingInformationCodes: [],
      alternativeOperationIds:
        classification === "conditional" ? input.registryOperation.alternativeOperationIds : [],
    };
  }
}
