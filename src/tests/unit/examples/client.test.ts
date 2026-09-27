import { describe, expect, it, vi } from "vitest";

// @ts-expect-error plain ESM example without types
import { createAuthorityClient } from "../../../../examples/agent/authority-client.mjs";

const KEY = "authority_rk_" + "ab".repeat(32);
const respond = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

function client(handlers: Array<(url: string, init: RequestInit) => ReturnType<typeof respond>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handlers[calls.length - 1](url, init);
  });
  return {
    authority: createAuthorityClient({ baseUrl: "https://a.example/", runtimeKey: KEY, fetchImpl }),
    calls,
  };
}
const task = "11111111-2222-3333-4444-555555555555";
const base = {
  taskId: task,
  tool: "github.get_issue",
  operation: "get_issue",
  resource: "o/r",
  arguments: { issue_number: "1" },
};

describe("example agent client", () => {
  it("authorizes, then executes through the connector, sending the key only as a bearer header", async () => {
    const { authority, calls } = client([
      () =>
        respond(200, {
          status: "allow",
          guidance: { nextStep: "proceed", message: "ok" },
          capability: { token: "authcap_v1_x" },
        }),
      () => respond(200, { result: "succeeded", data: { title: "Bug" }, receiptId: "r1" }),
    ]);
    const out = await authority.call(base);
    expect(out).toMatchObject({ kind: "done", data: { title: "Bug" }, receiptId: "r1" });
    expect(calls[0].url).toBe("https://a.example/api/v1/authorize");
    expect(calls[1].url).toBe("https://a.example/api/v1/github/execute");
    for (const c of calls) {
      expect((c.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
      expect(String(c.init.body)).not.toContain(KEY);
    }
    // The agent supplies no URL, method or path for the external call.
    expect(JSON.parse(String(calls[1].init.body))).not.toHaveProperty("url");
  });

  it("does not execute anything when Authority refuses, and returns the guidance", async () => {
    const { authority, calls } = client([
      () =>
        respond(200, {
          status: "deny",
          guidance: { nextStep: "stop", message: "Refused by policy." },
          capability: null,
        }),
    ]);
    expect(await authority.call({ ...base, tool: "github.read_file" })).toMatchObject({
      kind: "stop",
      message: "Refused by policy.",
    });
    expect(calls).toHaveLength(1);
  });

  it("maps guidance to explicit outcomes, and fails closed on anything unknown", async () => {
    for (const [step, kind] of [
      ["replan", "replan"],
      ["clarify", "clarify"],
      ["retry_later", "retry_later"],
      ["bogus", "stop"],
    ] as const) {
      const { authority } = client([
        () => respond(200, { status: "deny", guidance: { nextStep: step, message: "m" } }),
      ]);
      expect((await authority.call(base)).kind).toBe(kind);
    }
    const { authority } = client([() => respond(200, { status: "deny" })]); // no guidance at all
    expect((await authority.call(base)).kind).toBe("stop");
  });

  it("waits for approval instead of executing", async () => {
    const { authority, calls } = client([
      () =>
        respond(200, {
          status: "require_approval",
          guidance: { nextStep: "request_approval", message: "m" },
          approval: { statusUrl: "/api/v1/approvals/abc" },
        }),
    ]);
    expect(await authority.call(base)).toMatchObject({
      kind: "wait_for_approval",
      statusUrl: "/api/v1/approvals/abc",
    });
    expect(calls).toHaveLength(1);
  });

  it("never retries an indeterminate write", async () => {
    const { authority } = client([
      () =>
        respond(200, {
          status: "allow",
          guidance: { nextStep: "proceed", message: "ok" },
          capability: { token: "authcap_v1_x" },
        }),
      () => respond(504, { error: { code: "EXECUTION_INDETERMINATE" }, status: "indeterminate" }),
    ]);
    const out = await authority.call({ ...base, tool: "github.push_commit" });
    expect(out).toMatchObject({ kind: "stop", code: "EXECUTION_INDETERMINATE" });
    expect(out.message).toMatch(/do not retry/i);
  });

  it("requires a base URL and a key", () => {
    expect(() => createAuthorityClient({ baseUrl: "", runtimeKey: KEY })).toThrow();
    expect(() => createAuthorityClient({ baseUrl: "https://a", runtimeKey: "" })).toThrow();
  });
});
