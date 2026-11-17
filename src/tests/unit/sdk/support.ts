import { vi } from "vitest";

/** One request as it reached the (fake) server. */
export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  /** Raw text instead of JSON. */
  text?: string;
  requestId?: string;
}

export type FakeHandler = (
  req: RecordedRequest,
  init: RequestInit,
) => FakeReply | Promise<FakeReply> | Promise<never>;

/**
 * A tiny in-memory Authority: routes by "METHOD /path" (exact match, or a handler registered under a path prefix
 * ending in "*"). Records every request, including the Authorization header, so tests can assert exactly what
 * reached the server and with which credential.
 */
export function fakeAuthority(routes: Record<string, FakeHandler>) {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (input: URL, init: RequestInit): Promise<Response> => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const recorded: RecordedRequest = {
      method: init.method ?? "GET",
      path: input.pathname,
      authorization: headers.authorization,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(recorded);
    const routeKey = `${recorded.method} ${recorded.path}`;
    const handler =
      routes[routeKey] ??
      Object.entries(routes).find(([k]) => k.endsWith("*") && routeKey.startsWith(k.slice(0, -1)))?.[1];
    if (!handler) throw new Error(`fake authority: no route for ${routeKey}`);
    const reply = await handler(recorded, init);
    const status = reply.status ?? 200;
    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), {
      status,
      headers: {
        "content-type": "application/json",
        "x-request-id": reply.requestId ?? `req-${requests.length}`,
      },
    });
  });
  return { fetch, requests, paths: () => requests.map((r) => `${r.method} ${r.path}`) };
}

/** A fetch handler that never answers until its signal aborts (then rejects like real fetch). */
export function hang(_req: RecordedRequest, init: RequestInit): Promise<never> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

export const TASK_ID = "11111111-1111-4111-8111-111111111111";
export const TASK_B = "22222222-2222-4222-8222-222222222222";
export const AGENT_ID = "33333333-3333-4333-8333-333333333333";

export function session(taskId: string, token: string, expiresInMs = 600_000) {
  return {
    sessionId: `sess-${taskId.slice(0, 8)}`,
    token,
    taskId,
    contract: { id: `contract-${taskId.slice(0, 4)}`, version: 1 },
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  };
}

export const SLACK_MANIFEST_ENTRY = {
  tool: "slack.post_message",
  description: "Post a message",
  inputSchema: {
    type: "object",
    properties: { channel: { type: "string" }, text: { type: "string" } },
    required: ["channel", "text"],
    additionalProperties: false,
  },
  resourceConstraints: [{ key: "channel", equals: "C0ENGINEERING" }],
  maxInvocations: 1,
  remainingInvocations: 1,
  openArguments: ["text"],
  generatedArguments: ["text"],
  requiresApproval: false,
};

export function manifest(taskId: string, tools: unknown[] = [SLACK_MANIFEST_ENTRY]) {
  return {
    taskId,
    contract: { id: "contract-1", version: 1 },
    versions: { registry: "r1", compiler: "c1" },
    manifestHash: "hash",
    tools,
  };
}

export function allow(overrides: Record<string, unknown> = {}) {
  return {
    decisionId: "dec-1",
    status: "allow",
    reasonCodes: ["WITHIN_CONTRACT"],
    summary: "Permitted.",
    contract: { id: "contract-1", version: 1 },
    remainingInvocations: 0,
    requiresApproval: false,
    requiresClarification: false,
    requiresReplan: false,
    wasReplayed: false,
    enforcement: { mode: "off", degraded: false, narrowedBySecurityPolicy: false },
    capability: {
      id: "cap-1",
      token: "authority_cap_SECRET",
      tokenAlreadyIssued: false,
      tool: "slack.post_message",
      operation: "post_message",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      maxUses: 1,
    },
    approval: null,
    guidance: { nextStep: "proceed", message: "Permitted." },
    simulation: false,
    ...overrides,
  };
}

export function deny(reasonCodes: string[], overrides: Record<string, unknown> = {}) {
  return allow({
    status: "deny",
    reasonCodes,
    summary: "The arguments fall outside what this task authorizes.",
    capability: null,
    guidance: { nextStep: "stop", message: "Do not retry." },
    ...overrides,
  });
}
