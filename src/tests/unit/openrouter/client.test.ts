import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callChatCompletions, callDecisions } from "@/lib/openrouter/client";
import {
  OpenRouterForbiddenError,
  OpenRouterInsufficientCreditsError,
  OpenRouterMalformedResponseError,
  OpenRouterOutputTooLargeError,
  OpenRouterRateLimitedError,
  OpenRouterTimeoutError,
  OpenRouterUnauthorizedError,
  OpenRouterUnavailableError,
  OpenRouterUpstreamUnavailableError,
} from "@/lib/openrouter/errors";

const jsonResponse = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body) } as Response);

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("callChatCompletions", () => {
  it("returns the content and the actually-responded model, and sends the key only as a bearer header", async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      jsonResponse(200, { model: "openai/gpt-4o-mini", choices: [{ message: { content: '{"ok":true}' } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await callChatCompletions({
      model: "typesafe/jev-router",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.content).toBe('{"ok":true}');
    expect(result.respondedModel).toBe("openai/gpt-4o-mini");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-or-test-key");
    expect(String(init.body)).not.toContain("sk-or-test-key");
  });

  it("is unavailable, not thrown mid-request, when no key is configured", async () => {
    vi.unstubAllEnvs();
    await expect(callChatCompletions({ model: "m", messages: [] })).rejects.toBeInstanceOf(
      OpenRouterUnavailableError,
    );
  });

  for (const [status, ctor] of [
    [401, OpenRouterUnauthorizedError],
    [402, OpenRouterInsufficientCreditsError],
    [403, OpenRouterForbiddenError],
    [429, OpenRouterRateLimitedError],
    [502, OpenRouterUpstreamUnavailableError],
    [503, OpenRouterUpstreamUnavailableError],
  ] as const) {
    it(`maps HTTP ${status} to the typed error, without leaking the response body`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => jsonResponse(status, { error: { message: "some upstream detail, secret-ish" } })),
      );
      const err = await callChatCompletions({ model: "m", messages: [] }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ctor);
      expect((err as Error).message).not.toContain("secret-ish");
    });
  }

  it("times out and reports a timeout error, not a hang", async () => {
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
    await expect(callChatCompletions({ model: "m", messages: [], timeoutMs: 5 })).rejects.toBeInstanceOf(
      OpenRouterTimeoutError,
    );
  });

  it("rejects an oversized response before parsing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(200, { choices: [{ message: { content: "x".repeat(40_000) } }] })),
    );
    await expect(callChatCompletions({ model: "m", messages: [] })).rejects.toBeInstanceOf(
      OpenRouterOutputTooLargeError,
    );
  });

  it("treats a response with no message content as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(200, { choices: [] })),
    );
    await expect(callChatCompletions({ model: "m", messages: [] })).rejects.toBeInstanceOf(
      OpenRouterMalformedResponseError,
    );
  });

  it("sends provider routing only when explicitly requested", async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      jsonResponse(200, { choices: [{ message: { content: "{}" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await callChatCompletions({
      model: "m",
      messages: [],
      providerRouting: { data_collection: "deny", zdr: true },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.provider).toEqual({ data_collection: "deny", zdr: true });

    fetchMock.mockClear();
    await callChatCompletions({ model: "m", messages: [] });
    const body2 = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body2.provider).toBeUndefined();
  });
});

describe("callDecisions", () => {
  it("calls the alpha decisions endpoint, not chat completions, and returns typed answers", async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      jsonResponse(200, {
        model: "typesafe/jev-1.13-20260917",
        provider: "TypeSafe",
        answers: {
          classification: { type: "choice", choice: "required", confidence: 0.9, probabilities: {} },
        },
        usage: { input_tokens: 10, output_tokens: 2, cost: 0.000001 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await callDecisions({
      model: "typesafe/jev-1.13",
      state: { task: "x" },
      questions: {
        classification: { type: "choice", instructions: "?", criteria: { required: "d", unjustified: "d" } },
      },
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(result.respondedModel).toBe("typesafe/jev-1.13-20260917");
    expect(result.provider).toBe("TypeSafe");
    expect(result.costUsd).toBeCloseTo(0.000001);
    expect(result.answers.classification).toMatchObject({ choice: "required" });
  });

  it("treats a response with no answers object as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(200, { model: "x" })),
    );
    await expect(callDecisions({ model: "m", state: {}, questions: {} })).rejects.toBeInstanceOf(
      OpenRouterMalformedResponseError,
    );
  });

  it("maps a 429 the same way as chat completions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(429, {})),
    );
    await expect(callDecisions({ model: "m", state: {}, questions: {} })).rejects.toBeInstanceOf(
      OpenRouterRateLimitedError,
    );
  });
});
