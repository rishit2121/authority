import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthorityBackendClient } from "../../../../packages/authority-sdk/src/backend-client";

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthorityBackendClient.tasks.prepare", () => {
  it("stamps the task's own id onto the plan body -- the server's candidatePlanSchema requires it there", async () => {
    // Regression: this field was missing entirely, so every real prepare()
    // call failed server-side validation as "clarification" (found via a
    // live end-to-end run of examples/connector-quickstart).
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      jsonResponse(200, { taskId: "t1", status: "awaiting_approval" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuthorityBackendClient({ baseUrl: "https://a.example", apiKey: "authority_dk_x" });

    await client.tasks.prepare("t1", {
      plan: {
        schemaVersion: 1,
        nodes: [
          { id: "n1", sequence: 0, tool: "gmail.list_labels", arguments: {}, expectedSideEffect: "read" },
        ],
      },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.plan.taskId).toBe("t1");
  });

  it("does not require a taskId on the plan from the caller -- it is stamped on, not merely validated", async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      jsonResponse(200, { taskId: "t1", status: "ready", contractId: "c1", version: 1, tools: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuthorityBackendClient({ baseUrl: "https://a.example", apiKey: "authority_dk_x" });

    const outcome = await client.tasks.prepare("t1", {
      plan: {
        schemaVersion: 1,
        nodes: [
          { id: "n1", sequence: 0, tool: "github.get_issue", arguments: {}, expectedSideEffect: "read" },
        ],
      },
    });
    expect(outcome.status).toBe("ready");
  });

  it("sends generate:true untouched, with no plan field at all", async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      jsonResponse(200, { taskId: "t1", status: "ai_unavailable" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuthorityBackendClient({ baseUrl: "https://a.example", apiKey: "authority_dk_x" });

    await client.tasks.prepare("t1", { generate: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.generate).toBe(true);
    expect(body.plan).toBeUndefined();
  });
});
