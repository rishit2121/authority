import "server-only";

import type { PlanProposalProvider, PlanProposalResult, TrustedTaskInput } from "./plan-proposal-provider";

export const MOCK_PROVIDER_VERSION = "authority-mock-provider-2026-09-25";

/**
 * Deterministic candidate-plan generation for tests and local development
 * without an OpenAI key. Never calls a network. Never produces a tool id
 * outside the exact `availableTools` it was given — inventing one would
 * defeat the entire point of exercising "unknown tool" handling with this
 * provider under test.
 *
 * A custom `respond` function may be injected for tests that need specific
 * (including deliberately malformed, oversized, or hostile) output; the
 * default responder is only the local-development fallback.
 */
export class MockPlanProposalProvider implements PlanProposalProvider {
  constructor(private readonly respond: (input: TrustedTaskInput) => PlanProposalResult = defaultRespond) {}

  async proposePlan(input: TrustedTaskInput): Promise<PlanProposalResult> {
    return this.respond(input);
  }
}

function defaultRespond(input: TrustedTaskInput): PlanProposalResult {
  const firstReadTool = input.availableTools.find((t) => t.sideEffect === "read");
  const resource = input.resourceReferences[0];

  const nodes = firstReadTool
    ? [
        {
          id: "n1",
          sequence: 0,
          tool: firstReadTool.id,
          arguments: Object.fromEntries(
            firstReadTool.argumentFields
              .filter((f) => f.required || f.identifiesResource)
              .map((f) => [f.key, resource ?? "unspecified"]),
          ),
          dependencies: [],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: firstReadTool.sideEffect,
          maxInvocations: 1,
        },
      ]
    : [];

  return {
    plan: { schemaVersion: 1, taskId: input.taskId, nodes },
    metadata: { provider: "mock", model: "deterministic-mock", providerVersion: MOCK_PROVIDER_VERSION },
  };
}
