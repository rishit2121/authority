import { afterEach, describe, expect, it, vi } from "vitest";

import { GithubClient } from "@/lib/github/client";
import { MAX_RESPONSE_BYTES } from "@/lib/github/constants";
import { GithubDefiniteError, GithubIndeterminateError, TransportError } from "@/lib/github/errors";
import { LiveGithubTransport, type GithubHttpResponse, type GithubTransport } from "@/lib/github/transport";

const okAuth = { kind: "installation_token" as const, token: "ghs_secret_token_value_0123456789" };
const req = { route: "getIssue" as const, params: { owner: "acme", repo: "widgets", number: 1 } };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  });
  return calls;
}

describe("LiveGithubTransport egress", () => {
  it("only ever calls api.github.com over https, with the credential in the Authorization header", async () => {
    const calls = stubFetch(() => new Response('{"ok":true}', { status: 200, headers: { "x-github-request-id": "ABC:1" } }));
    const res = await new LiveGithubTransport().send(req, okAuth, { timeoutMs: 1000 });
    expect(res).toMatchObject({ status: 200, requestId: "ABC:1", body: { ok: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin).toBe("https://api.github.com");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${okAuth.token}`);
    expect(headers["X-GitHub-Api-Version"]).toBeTruthy();
    expect(calls[0].init.redirect).toBe("manual");
    expect(String(calls[0].url)).not.toContain(okAuth.token);
  });

  it("refuses to attach a credential of the wrong kind to a route", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    await expect(new LiveGithubTransport().send(req, { kind: "app_jwt", token: "x" }, { timeoutMs: 1000 })).rejects.toBeInstanceOf(TransportError);
    expect(calls).toHaveLength(0);
  });

  it("never follows a redirect, whatever the status or host", async () => {
    for (const status of [301, 302, 307, 308]) {
      const calls = stubFetch(() => new Response(null, { status, headers: { location: "https://evil.example/steal" } }));
      await expect(new LiveGithubTransport().send(req, okAuth, { timeoutMs: 1000 })).rejects.toMatchObject({ kind: "redirect" });
      expect(calls).toHaveLength(1);
    }
  });

  it("caps response size (declared and streamed)", async () => {
    stubFetch(() => new Response("{}", { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }));
    await expect(new LiveGithubTransport().send(req, okAuth, { timeoutMs: 1000 })).rejects.toMatchObject({ kind: "too_large" });
    stubFetch(() => new Response(new Uint8Array(MAX_RESPONSE_BYTES + 10), { status: 200 }));
    await expect(new LiveGithubTransport().send(req, okAuth, { timeoutMs: 1000 })).rejects.toMatchObject({ kind: "too_large" });
  });

  it("times out", async () => {
    stubFetch((_url, init) => new Promise((_res, rej) => (init.signal as AbortSignal).addEventListener("abort", () => rej(new Error("aborted")))));
    await expect(new LiveGithubTransport().send(req, okAuth, { timeoutMs: 20 })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("maps network errors and unparseable bodies", async () => {
    stubFetch(() => Promise.reject(new Error("ECONNRESET")));
    await expect(new LiveGithubTransport().send(req, okAuth, { timeoutMs: 100 })).rejects.toMatchObject({ kind: "network" });
    stubFetch(() => new Response("<html>", { status: 200 }));
    await expect(new LiveGithubTransport().send(req, okAuth, { timeoutMs: 100 })).rejects.toMatchObject({ kind: "bad_json" });
  });
});

describe("failure classification", () => {
  const client = (impl: () => Promise<GithubHttpResponse>) =>
    new GithubClient({ send: impl } as GithubTransport, () => "jwt", "mock");
  const resp = (status: number, extra: Partial<GithubHttpResponse> = {}): GithubHttpResponse => ({ status, requestId: null, rateLimitRemaining: null, retryAfterSeconds: null, body: null, ...extra });
  const READ = req;
  const WRITE = { route: "createRef" as const, params: { owner: "acme", repo: "widgets" }, body: { ref: "refs/heads/x", sha: "0".repeat(40) } };

  it.each([
    [401, "AUTH_REJECTED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [422, "UNPROCESSABLE"],
    [400, "HTTP_ERROR"],
  ])("treats a %s on a write as a DEFINITE failure (%s)", async (status, code) => {
    await expect(client(async () => resp(status)).request(WRITE, okAuth)).rejects.toMatchObject({ name: "GithubDefiniteError", code });
  });

  it("recognizes primary and secondary rate limits as definite", async () => {
    await expect(client(async () => resp(403, { rateLimitRemaining: 0 })).request(WRITE, okAuth)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(client(async () => resp(403, { retryAfterSeconds: 60 })).request(WRITE, okAuth)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(client(async () => resp(429)).request(READ, okAuth)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("treats a 5xx on a WRITE as indeterminate but on a READ as a definite failure", async () => {
    for (const status of [500, 502, 503, 504]) {
      await expect(client(async () => resp(status)).request(WRITE, okAuth)).rejects.toBeInstanceOf(GithubIndeterminateError);
      await expect(client(async () => resp(status)).request(READ, okAuth)).rejects.toBeInstanceOf(GithubDefiniteError);
    }
  });

  it("treats a timeout / network loss / oversize on a WRITE as indeterminate, on a READ as definite", async () => {
    for (const kind of ["timeout", "network", "too_large", "bad_json"] as const) {
      const c = client(async () => {
        throw new TransportError(kind);
      });
      await expect(c.request(WRITE, okAuth)).rejects.toBeInstanceOf(GithubIndeterminateError);
      await expect(c.request(READ, okAuth)).rejects.toBeInstanceOf(GithubDefiniteError);
    }
  });

  it("treats a redirect as a definite, unfollowed refusal even for writes", async () => {
    const c = client(async () => {
      throw new TransportError("redirect");
    });
    await expect(c.request(WRITE, okAuth)).rejects.toMatchObject({ name: "GithubDefiniteError", code: "REDIRECT_REJECTED" });
  });

  it("treats a local route-building error as definite (nothing was sent)", async () => {
    const c = client(async () => {
      throw new Error("RouteBuildError");
    });
    await expect(c.request(WRITE, okAuth)).rejects.toMatchObject({ name: "GithubDefiniteError", code: "REQUEST_REJECTED_LOCALLY" });
  });

  it("lets a caller tolerate specific statuses (existence probes)", async () => {
    const r = await client(async () => resp(404)).request(READ, okAuth, { tolerate: [404] });
    expect(r.status).toBe(404);
  });
});
