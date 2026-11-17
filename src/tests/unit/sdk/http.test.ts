// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { AuthorityBackendClient } from "../../../../packages/authority-sdk/src/backend-client";
import { AuthorityApiError, AuthorityTimeoutError } from "../../../../packages/authority-sdk/src/errors";
import { combineSignals, request } from "../../../../packages/authority-sdk/src/http";

function rawResponse(status: number, text: string, headers: Record<string, string> = {}) {
  return new Response(text, { status, headers });
}

describe("SDK http: non-JSON bodies", () => {
  it("turns a non-JSON success body into AuthorityApiError(INVALID_RESPONSE), not a raw SyntaxError", async () => {
    const fetchMock = vi.fn(async () => rawResponse(200, "<html>proxy</html>", { "x-request-id": "req-1" }));
    const error = await request(
      { baseUrl: "https://a.example", token: "t", fetch: fetchMock },
      "/api/v1/health",
      { method: "GET" },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthorityApiError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE", status: 200, requestId: "req-1" });
    // The raw body is never copied into the error: it may be anything.
    expect(JSON.stringify((error as AuthorityApiError).body ?? null)).not.toContain("proxy");
  });

  it("turns a non-JSON error body (a 502 gateway page) into AuthorityApiError with the real status", async () => {
    const fetchMock = vi.fn(async () => rawResponse(502, "Bad Gateway"));
    const error = await request({ baseUrl: "https://a.example", token: "t", fetch: fetchMock }, "/x", {
      method: "POST",
      body: {},
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthorityApiError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE", status: 502 });
  });

  it("still parses a JSON error body into code/message/requestId", async () => {
    const fetchMock = vi.fn(async () =>
      rawResponse(
        409,
        JSON.stringify({ error: { code: "NO_ACTIVE_CONTRACT", message: "m", requestId: "r9" } }),
      ),
    );
    const error = await request({ baseUrl: "https://a.example", token: "t", fetch: fetchMock }, "/x", {
      method: "GET",
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "NO_ACTIVE_CONTRACT", status: 409, requestId: "r9", message: "m" });
  });

  it("uses an injected fetch instead of the global one", async () => {
    const injected = vi.fn(async () =>
      rawResponse(200, JSON.stringify({ customerId: "c1", wasCreated: true })),
    );
    const global = vi.fn();
    vi.stubGlobal("fetch", global);
    try {
      const backend = new AuthorityBackendClient({
        baseUrl: "https://a.example",
        apiKey: "k",
        fetch: injected,
      });
      await backend.customers.ensure({ externalId: "u1" });
      expect(injected).toHaveBeenCalledTimes(1);
      expect(global).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("SDK http: signals", () => {
  it("combineSignals.dispose removes the exact listener it added", () => {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, "addEventListener");
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const { dispose } = combineSignals([caller.signal]);
    dispose();
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]);
  });

  it("a long-lived caller signal does not accumulate listeners across requests", async () => {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, "addEventListener");
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const fetchMock = vi.fn(async () => rawResponse(200, "{}"));
    for (let i = 0; i < 5; i += 1) {
      await request(
        { baseUrl: "https://a.example", token: "t", fetch: fetchMock },
        "/x",
        { method: "GET" },
        {
          signal: caller.signal,
        },
      );
    }
    expect(add).toHaveBeenCalledTimes(5);
    const added = add.mock.calls.map((c) => c[1]);
    const removed = remove.mock.calls.map((c) => c[1]);
    expect(removed).toEqual(added);
  });

  it("the combined signal still aborts when the caller aborts, and reports reason 'aborted'", async () => {
    const caller = new AbortController();
    const fetchMock = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = request(
      { baseUrl: "https://a.example", token: "t", fetch: fetchMock },
      "/x",
      {
        method: "GET",
      },
      { signal: caller.signal },
    );
    caller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthorityTimeoutError);
    expect((error as AuthorityTimeoutError).reason).toBe("aborted");
  });

  it("reports reason 'timeout' when the client's own timeout fires", async () => {
    const fetchMock = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const error = await request(
      { baseUrl: "https://a.example", token: "t", fetch: fetchMock },
      "/x",
      { method: "GET" },
      { timeoutMs: 5 },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthorityTimeoutError);
    expect((error as AuthorityTimeoutError).reason).toBe("timeout");
  });
});
