import { describe, expect, it, vi } from "vitest";

import { buildPilotNotification, escapeHtml, sendPilotNotification } from "@/lib/pilot/notify";
import { clientIpHash, normalizePilotEmail, pilotRequestSchema } from "@/lib/pilot/request";

const valid = {
  name: "  Ada  ",
  email: "  Ada@Example.COM ",
  company: "",
  building: "An agent that files refunds",
  usage: "Scope Stripe refunds per ticket",
  services: "",
};

describe("pilot request validation", () => {
  it("trims, keeps required fields and nulls empty optional ones", () => {
    const parsed = pilotRequestSchema.parse(valid);
    expect(parsed).toMatchObject({ name: "Ada", email: "Ada@Example.COM", company: null, services: null });
  });

  it("dedups on the trimmed, lowercased email", () => {
    expect(normalizePilotEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it.each([
    ["missing name", { name: " " }],
    ["bad email", { email: "nope" }],
    ["missing building", { building: "" }],
    ["missing usage", { usage: "  " }],
    ["oversized building", { building: "x".repeat(2001) }],
    ["oversized services", { services: "x".repeat(501) }],
    ["oversized name", { name: "x".repeat(121) }],
  ])("rejects %s", (_label, patch) => {
    expect(pilotRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("hashes the first forwarded address and never returns the raw IP", () => {
    const a = clientIpHash("203.0.113.9, 10.0.0.1", null);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(clientIpHash("203.0.113.9", null));
    expect(a).not.toBe(clientIpHash("203.0.113.10", null));
    expect(clientIpHash(null, "198.51.100.1")).toBe(clientIpHash("198.51.100.1", null));
  });
});

const input = {
  requestId: "11111111-2222-4333-8444-555555555555",
  ownerEmail: "owner@example.com",
  name: "<script>alert(1)</script>\r\nBcc: x@evil.test",
  email: "ada@example.com",
  company: "Acme & Co",
  building: `<img src=x onerror="steal()">`,
  usage: "refunds",
  services: null,
  dashboardUrl: "https://authority.example/app/pilot?id=1",
};

describe("pilot owner notification", () => {
  it("escapes applicant content in the HTML body and strips newlines from the subject", () => {
    const msg = buildPilotNotification(input);
    expect(msg.html).not.toContain("<script>");
    expect(msg.html).not.toContain("<img");
    expect(msg.html).toContain("&lt;script&gt;");
    expect(msg.html).toContain("Acme &amp; Co");
    expect(msg.subject).not.toMatch(/[\r\n]/);
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });

  it("is not_configured without a key or sender, and makes no request", async () => {
    const fetchImpl = vi.fn();
    const r = await sendPilotNotification(input, { env: {} as NodeJS.ProcessEnv, fetchImpl });
    expect(r.status).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends only to the fixed owner with the request id as idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const env = {
      RESEND_API_KEY: "re_test_secret",
      PILOT_NOTIFY_FROM: "A <p@x.test>",
    } as unknown as NodeJS.ProcessEnv;
    const r = await sendPilotNotification(input, { env, fetchImpl });
    expect(r.status).toBe("sent");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers["idempotency-key"]).toBe(`authority-pilot-request-${input.requestId}`);
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["owner@example.com"]);
    expect(JSON.stringify(body)).not.toContain('ada@example.com"]');
    expect(r.detail).not.toContain("re_test_secret");
  });

  it("reports failure (never throws) on HTTP errors and network errors, without secrets", async () => {
    const env = {
      RESEND_API_KEY: "re_test_secret",
      PILOT_NOTIFY_FROM: "A <p@x.test>",
    } as unknown as NodeJS.ProcessEnv;
    const http = await sendPilotNotification(input, {
      env,
      fetchImpl: vi.fn().mockResolvedValue(new Response("bad key re_test_secret", { status: 401 })),
    });
    expect(http).toEqual({ status: "failed", detail: "resend http 401" });
    const net = await sendPilotNotification(input, {
      env,
      fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNRESET re_test_secret")),
    });
    expect(net.status).toBe("failed");
    expect(net.detail).not.toContain("re_test_secret");
  });
});
