import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenRouterJevRouterPlanProposalProvider } from "@/lib/ai/openrouter-jev-router-plan-proposal-provider";
import {
  PlanProposalOutputTooLargeError,
  PlanProposalProviderError,
  PlanProposalTimeoutError,
} from "@/lib/ai/plan-proposal-provider";

const INPUT = {
  taskId: "task_1",
  taskIntent: "Resolve issue #991",
  availableTools: [],
  policySummaries: [],
  resourceReferences: [],
};

const chatResponse = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body) } as Response);

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenRouterJevRouterPlanProposalProvider", () => {
  it("throws PlanProposalProviderError when no OpenRouter key is configured", async () => {
    vi.unstubAllEnvs();
    const provider = new OpenRouterJevRouterPlanProposalProvider();
    await expect(provider.proposePlan(INPUT)).rejects.toBeInstanceOf(PlanProposalProviderError);
  });

  it("uses the default typesafe/jev-router model and reports the actually-responded model separately", async () => {
    const planJson = JSON.stringify({ schemaVersion: 1, taskId: "task_1", nodes: [] });
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      chatResponse(200, {
        model: "anthropic/claude-3.5-sonnet",
        choices: [{ message: { content: planJson } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenRouterJevRouterPlanProposalProvider();
    const result = await provider.proposePlan(INPUT);
    expect(result.plan).toEqual({ schemaVersion: 1, taskId: "task_1", nodes: [] });
    expect(result.metadata).toMatchObject({
      provider: "openrouter",
      model: "typesafe/jev-router",
      respondedModel: "anthropic/claude-3.5-sonnet",
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("typesafe/jev-router");
    expect(body.response_format.type).toBe("json_schema");
  });

  it("respects an overridden OPENROUTER_PLAN_MODEL", async () => {
    vi.stubEnv("OPENROUTER_PLAN_MODEL", "typesafe/jev-router-preview");
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      chatResponse(200, { choices: [{ message: { content: "{}" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await new OpenRouterJevRouterPlanProposalProvider().proposePlan(INPUT);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("typesafe/jev-router-preview");
  });

  it("surfaces a real error rather than ever substituting a mock, on 401/429/timeout/oversized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, _init: RequestInit) => chatResponse(401, {})),
    );
    await expect(new OpenRouterJevRouterPlanProposalProvider().proposePlan(INPUT)).rejects.toBeInstanceOf(
      PlanProposalProviderError,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, _init: RequestInit) => chatResponse(429, {})),
    );
    await expect(new OpenRouterJevRouterPlanProposalProvider().proposePlan(INPUT)).rejects.toBeInstanceOf(
      PlanProposalProviderError,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, _init: RequestInit) =>
        chatResponse(200, { choices: [{ message: { content: "x".repeat(40_000) } }] }),
      ),
    );
    await expect(new OpenRouterJevRouterPlanProposalProvider().proposePlan(INPUT)).rejects.toBeInstanceOf(
      PlanProposalOutputTooLargeError,
    );
  });

  it("times out rather than hanging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      ),
    );
    await expect(new OpenRouterJevRouterPlanProposalProvider(50).proposePlan(INPUT)).rejects.toBeInstanceOf(
      PlanProposalTimeoutError,
    );
  });

  it("rejects a non-JSON message content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, _init: RequestInit) =>
        chatResponse(200, { choices: [{ message: { content: "not json" } }] }),
      ),
    );
    await expect(new OpenRouterJevRouterPlanProposalProvider().proposePlan(INPUT)).rejects.toBeInstanceOf(
      PlanProposalProviderError,
    );
  });

  it("applies privacy routing only when the operator opts in", async () => {
    vi.stubEnv("OPENROUTER_DENY_DATA_COLLECTION", "1");
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      chatResponse(200, { choices: [{ message: { content: "{}" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await new OpenRouterJevRouterPlanProposalProvider().proposePlan(INPUT);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.provider).toEqual({ data_collection: "deny" });
  });
});
