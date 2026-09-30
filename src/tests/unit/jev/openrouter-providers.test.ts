import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenRouterJevNecessityProvider } from "@/lib/jev/openrouter-necessity-provider";
import { OpenRouterJevRiskProvider } from "@/lib/jev/openrouter-risk-provider";
import { JevProviderError, JevProviderUnavailableError } from "@/lib/jev/types";
import type { NecessityEvaluationInput } from "@/lib/jev/necessity-provider";
import type { RiskEvaluationInput } from "@/lib/jev/risk-provider";

const necessityInput: NecessityEvaluationInput = {
  taskId: "t",
  taskIntent: "Resolve issue #991",
  plan: [
    { id: "n1", tool: "github.get_issue", sideEffect: "read", dependencies: [], dataFlowFromNodeIds: [] },
  ],
  nodeId: "n1",
  inBackwardSlice: true,
  registryOperation: {
    id: "github.get_issue",
    provider: "github",
    sideEffect: "read",
    resourceType: "issue",
    dataSensitivity: "internal",
    preconditions: [],
    effects: [],
    alternativeOperationIds: [],
  },
  activePolicySummaries: [],
  agentJustification: null,
};

const riskInput: RiskEvaluationInput = {
  taskIntent: "Resolve issue #991",
  tool: "github.get_issue",
  operation: "get_issue",
  resource: "acme/widgets",
  argumentKeys: ["issue_number"],
  contractAllowedTools: ["github.get_issue"],
  inProposedPlan: true,
  expectedPlanNodeId: "n1",
  priorCallSummaries: [],
  remainingInvocations: 1,
  contractExpiresInSeconds: 100,
};

const decisionsResponse = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body) } as Response);

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
  vi.stubEnv("OPENROUTER_JEV_DECISION_MODEL", "typesafe/jev-1.13");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenRouterJevNecessityProvider", () => {
  it("throws JevProviderUnavailableError at construction when OPENROUTER_JEV_DECISION_MODEL is unset", () => {
    vi.stubEnv("OPENROUTER_JEV_DECISION_MODEL", "");
    expect(() => new OpenRouterJevNecessityProvider()).toThrow(JevProviderUnavailableError);
  });

  it("calls the real Decisions API path and maps a live-shaped response", async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      decisionsResponse(200, {
        model: "typesafe/jev-1.13-20260917",
        provider: "TypeSafe",
        answers: { classification: { type: "choice", choice: "required", confidence: 0.8 } },
        usage: { cost: 0.00002 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterJevNecessityProvider();
    const result = await provider.evaluate(necessityInput, { signal: new AbortController().signal });
    expect(result.classification).toBe("required");
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/alpha/decisions");
  });

  it("maps a 401 into a JevProviderError carrying the openrouter unauthorized category", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, _init: RequestInit) => decisionsResponse(401, {})),
    );
    const provider = new OpenRouterJevNecessityProvider();
    const err = await provider
      .evaluate(necessityInput, { signal: new AbortController().signal })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JevProviderError);
    expect((err as JevProviderError).category).toBe("unauthorized");
  });
});

describe("OpenRouterJevRiskProvider", () => {
  it("calls the real Decisions API path and maps a live-shaped response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, _init: RequestInit) =>
        decisionsResponse(200, {
          answers: { riskClass: { type: "choice", choice: "low", confidence: 0.7 } },
        }),
      ),
    );
    const result = await new OpenRouterJevRiskProvider().evaluate(riskInput, {
      signal: new AbortController().signal,
    });
    expect(result.riskClass).toBe("low");
  });

  it("maps a 429 into a JevProviderError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, _init: RequestInit) => decisionsResponse(429, {})),
    );
    const err = await new OpenRouterJevRiskProvider()
      .evaluate(riskInput, { signal: new AbortController().signal })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JevProviderError);
    expect((err as JevProviderError).category).toBe("rate_limited");
  });
});
