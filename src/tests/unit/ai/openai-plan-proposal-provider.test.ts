import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAiPlanProposalProvider } from "@/lib/ai/openai-plan-proposal-provider";
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

function chatCompletionResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenAiPlanProposalProvider", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("throws PlanProposalProviderError when no API key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAiPlanProposalProvider();
    await expect(provider.proposePlan(INPUT)).rejects.toBeInstanceOf(PlanProposalProviderError);
  });

  it("parses a well-formed structured response into the raw plan", async () => {
    const planJson = JSON.stringify({ schemaVersion: 1, taskId: "task_1", nodes: [] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(chatCompletionResponse(planJson)));
    const provider = new OpenAiPlanProposalProvider();
    const result = await provider.proposePlan(INPUT);
    expect(result.plan).toEqual({ schemaVersion: 1, taskId: "task_1", nodes: [] });
    expect(result.metadata.provider).toBe("openai");
  });

  it("throws PlanProposalProviderError when the message content is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(chatCompletionResponse("not json")));
    const provider = new OpenAiPlanProposalProvider();
    await expect(provider.proposePlan(INPUT)).rejects.toBeInstanceOf(PlanProposalProviderError);
  });

  it("throws PlanProposalOutputTooLargeError when the response exceeds the size cap, without retrying", async () => {
    const hugeContent = "x".repeat(1000);
    const fetchMock = vi.fn().mockResolvedValue(chatCompletionResponse(hugeContent));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiPlanProposalProvider(20_000, 100);
    await expect(provider.proposePlan(INPUT)).rejects.toBeInstanceOf(PlanProposalOutputTooLargeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws PlanProposalTimeoutError when the request is aborted, without retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }),
    );
    const provider = new OpenAiPlanProposalProvider(5);
    await expect(provider.proposePlan(INPUT)).rejects.toBeInstanceOf(PlanProposalTimeoutError);
  });

  it("retries once on a non-timeout network failure, then succeeds", async () => {
    const planJson = JSON.stringify({ schemaVersion: 1, taskId: "task_1", nodes: [] });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(chatCompletionResponse(planJson));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiPlanProposalProvider();
    const result = await provider.proposePlan(INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.plan).toEqual({ schemaVersion: 1, taskId: "task_1", nodes: [] });
  });

  it("throws PlanProposalProviderError after exhausting the single retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("still down"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiPlanProposalProvider();
    await expect(provider.proposePlan(INPUT)).rejects.toBeInstanceOf(PlanProposalProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws PlanProposalProviderError on a non-2xx response, without leaking the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("secret internal detail", { status: 500 })),
    );
    const provider = new OpenAiPlanProposalProvider();
    await expect(provider.proposePlan(INPUT)).rejects.toMatchObject({
      message: expect.not.stringContaining("secret internal detail") as unknown as string,
    });
  });

  it("never sends more than the trusted task input to the API", async () => {
    const planJson = JSON.stringify({ schemaVersion: 1, taskId: "task_1", nodes: [] });
    const fetchMock = vi.fn().mockResolvedValue(chatCompletionResponse(planJson));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiPlanProposalProvider();
    await provider.proposePlan(INPUT);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as { messages: { content: string }[] };
    const userMessage = body.messages.find((m: { content: string }) => m.content.includes("taskIntent"));
    expect(userMessage?.content).not.toMatch(/OPENAI_API_KEY|service_role|SUPABASE/i);
  });
});
