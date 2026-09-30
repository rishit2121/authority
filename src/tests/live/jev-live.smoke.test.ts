import { describe, expect, it } from "vitest";

import { NECESSITY_CLASSIFICATIONS } from "@/lib/jev/types";
import { RISK_CATEGORIES, RISK_CLASSES, RISK_EVIDENCE_CODES } from "@/lib/jev/types";
import { COMPLETENESS_CLASSIFICATIONS, MISSING_INFORMATION_CODES } from "@/lib/jev/types";
import { OpenRouterJevNecessityProvider } from "@/lib/jev/openrouter-necessity-provider";
import { OpenRouterJevRiskProvider } from "@/lib/jev/openrouter-risk-provider";
import { OpenRouterJevCompletenessProvider } from "@/lib/jev/openrouter-completeness-provider";
import { OpenRouterJevRouterPlanProposalProvider } from "@/lib/ai/openrouter-jev-router-plan-proposal-provider";
import { buildTrustedTaskInput } from "@/lib/ai/build-trusted-task-input";
import { candidatePlanSchema } from "@/lib/domain";
import { getOpenRouterEnv } from "@/lib/openrouter/env";
import { githubDemoRegistry, loadRegistry } from "@/lib/registry";

/**
 * Live smoke test: the real OpenRouter Decisions API (`typesafe/jev-1.13` or whichever model
 * `OPENROUTER_JEV_DECISION_MODEL` names) and, separately, the real `typesafe/jev-router` chat-completions
 * endpoint (`OPENROUTER_PLAN_MODEL`). Required environment (see docs/jev/SETUP.md):
 *
 *   OPENROUTER_API_KEY=<a real key>
 *   OPENROUTER_JEV_DECISION_MODEL=<the exact verified direct-Jev model slug>
 *   JEV_LIVE_SMOKE=1
 *
 * This makes real, billed API calls. It never touches the database, never touches GitHub, and asserts only on
 * *shape* (valid classification/confidence/allowlist membership), never on Jev's specific judgment for a given
 * input — that calibration question belongs to the evaluation harness (docs/jev/SETUP.md), not this smoke test.
 * A result from this file is the one thing in this codebase that may be called a verified LIVE Jev response;
 * every other necessity/risk/completeness/plan-proposal test in this repository uses a mock and must not be
 * described as live verification.
 */
const env = getOpenRouterEnv();
const armed = process.env.JEV_LIVE_SMOKE === "1" && env !== null && env.jevDecisionModel !== null;

describe.skipIf(!armed)("live Jev smoke test via OpenRouter (opt-in)", () => {
  it("returns a well-formed, allowlist-respecting necessity evaluation from the real Decisions API", async () => {
    const provider = new OpenRouterJevNecessityProvider();
    const result = await provider.evaluate(
      {
        taskId: "00000000-0000-4000-8000-000000000001",
        taskIntent: "Read GitHub issue 42 and summarize it in a comment.",
        plan: [
          {
            id: "read-issue",
            tool: "github.get_issue",
            sideEffect: "read",
            dependencies: [],
            dataFlowFromNodeIds: [],
          },
        ],
        nodeId: "read-issue",
        inBackwardSlice: true,
        registryOperation: {
          id: "github.get_issue",
          provider: "github",
          sideEffect: "read",
          resourceType: "issue",
          dataSensitivity: "internal",
          preconditions: [],
          effects: ["returns issue title, body and state"],
          alternativeOperationIds: [],
        },
        activePolicySummaries: [],
        agentJustification: null,
      },
      { signal: new AbortController().signal },
    );
    expect(NECESSITY_CLASSIFICATIONS).toContain(result.classification);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.requiredPredecessorNodeIds.every((id) => id === "read-issue" || false)).toBe(true);
    expect(result.alternativeOperationIds).toEqual([]); // none were offered as candidates
    for (const code of result.missingInformationCodes) {
      expect(MISSING_INFORMATION_CODES).toContain(code);
    }
  });

  it("returns a well-formed risk evaluation from the real Decisions API", async () => {
    const provider = new OpenRouterJevRiskProvider();
    const result = await provider.evaluate(
      {
        taskIntent: "Read GitHub issue 42 and summarize it in a comment.",
        tool: "github.get_issue",
        operation: "get_issue",
        resource: "issue:42",
        argumentKeys: ["issue_number"],
        contractAllowedTools: ["github.get_issue"],
        inProposedPlan: true,
        expectedPlanNodeId: "read-issue",
        priorCallSummaries: [],
        remainingInvocations: 1,
        contractExpiresInSeconds: 300,
      },
      { signal: new AbortController().signal },
    );
    expect(RISK_CLASSES).toContain(result.riskClass);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    for (const c of result.categories) expect(RISK_CATEGORIES).toContain(c);
    for (const c of result.evidenceCodes) expect(RISK_EVIDENCE_CODES).toContain(c);
  });

  it("returns a well-formed plan-completeness evaluation from the real Decisions API", async () => {
    const provider = new OpenRouterJevCompletenessProvider();
    const result = await provider.evaluate(
      {
        taskIntent: "Read GitHub issue 42 and summarize it in a comment.",
        plan: [
          {
            id: "read-issue",
            tool: "github.get_issue",
            sideEffect: "read",
            dependencies: [],
            dataFlowFromNodeIds: [],
          },
        ],
        candidateOperationIds: ["github.create_issue_comment"],
        activePolicySummaries: [],
      },
      { signal: new AbortController().signal },
    );
    expect(COMPLETENESS_CLASSIFICATIONS).toContain(result.classification);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    for (const id of result.possibleMissingOperationIds) {
      expect(["github.create_issue_comment"]).toContain(id);
    }
  });

  it("returns a candidate plan from the real typesafe/jev-router endpoint, and reports the actually-routed model", async () => {
    const provider = new OpenRouterJevRouterPlanProposalProvider();
    const registry = loadRegistry(githubDemoRegistry);
    const trustedInput = buildTrustedTaskInput({
      taskId: "00000000-0000-4000-8000-000000000001",
      taskIntent: "Read GitHub issue 42 and summarize it in a comment.",
      registry,
      activePolicies: [],
      resourceReferences: [],
    });
    const result = await provider.proposePlan(trustedInput);
    expect(result.metadata.provider).toBe("openrouter");
    expect(result.metadata.model).toBe(env!.planModel);
    // A router may or may not report a different model; when it does, it must be a non-empty string.
    if (result.metadata.respondedModel !== undefined) {
      expect(result.metadata.respondedModel.length).toBeGreaterThan(0);
    }
    // The output is untrusted regardless of source — this only checks that this specific call round-tripped
    // *some* parseable content, never that plan generation should be trusted without the full validation pipeline.
    const parsed = candidatePlanSchema.safeParse(result.plan);
    if (!parsed.success) {
      console.warn(
        "jev-router did not return output matching candidatePlanSchema on this call — this is a valid, " +
          "reportable outcome (see docs/jev/OVERVIEW.md's Role A honesty requirement), not a test bug:",
        parsed.error.issues[0]?.message,
      );
    }
  });
});
