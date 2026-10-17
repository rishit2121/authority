import { beforeEach, describe, expect, it, vi } from "vitest";

const submitPilotRequest = vi.fn();
const recordPilotNotification = vi.fn();
const sendPilotNotification = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("@/lib/pilot/gateway", () => ({
  submitPilotRequest: (...a: unknown[]) => submitPilotRequest(...a),
  recordPilotNotification: (...a: unknown[]) => recordPilotNotification(...a),
}));
vi.mock("@/lib/pilot/notify", () => ({
  sendPilotNotification: (...a: unknown[]) => sendPilotNotification(...a),
}));
vi.mock("@/lib/connectors/shared/public-base-url", () => ({
  publicBaseUrl: () => "https://authority.example",
}));

const { requestPilotAccessAction } = await import("@/app/(auth)/request-access/actions");
const { PILOT_REQUEST_RECEIVED_MESSAGE, PILOT_RATE_LIMITED_MESSAGE } = await import("@/lib/pilot/request");

function form(patch: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const values = {
    name: "Ada",
    email: "Ada@Example.com",
    company: "",
    building: "agent",
    usage: "refunds",
    services: "",
    ...patch,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  submitPilotRequest.mockReset();
  recordPilotNotification.mockReset();
  sendPilotNotification.mockReset();
});

describe("public request-access action (anonymous)", () => {
  it("saves, notifies the owner once and confirms", async () => {
    submitPilotRequest.mockResolvedValue({
      status: "ok",
      requestId: ID,
      isNew: true,
      ownerEmail: "o@x.test",
    });
    sendPilotNotification.mockResolvedValue({ status: "sent", detail: "resend 200" });
    const r = await requestPilotAccessAction({}, form());
    expect(r).toEqual({ success: PILOT_REQUEST_RECEIVED_MESSAGE });
    const [, ipHash] = submitPilotRequest.mock.calls[0];
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sendPilotNotification).toHaveBeenCalledTimes(1);
    expect(sendPilotNotification.mock.calls[0][0]).toMatchObject({
      ownerEmail: "o@x.test",
      dashboardUrl: `https://authority.example/app/pilot?id=${ID}`,
    });
    expect(recordPilotNotification).toHaveBeenCalledWith(ID, "sent", "resend 200");
  });

  it("does not lose the request or change the response when notification fails or throws", async () => {
    submitPilotRequest.mockResolvedValue({
      status: "ok",
      requestId: ID,
      isNew: true,
      ownerEmail: "o@x.test",
    });
    sendPilotNotification.mockRejectedValue(new Error("boom"));
    expect(await requestPilotAccessAction({}, form())).toEqual({ success: PILOT_REQUEST_RECEIVED_MESSAGE });

    sendPilotNotification.mockResolvedValue({ status: "failed", detail: "resend http 500" });
    recordPilotNotification.mockRejectedValue(new Error("db down"));
    expect(await requestPilotAccessAction({}, form())).toEqual({ success: PILOT_REQUEST_RECEIVED_MESSAGE });
    expect(submitPilotRequest).toHaveBeenCalledTimes(2);
  });

  it("answers a duplicate exactly like a new request and does not re-notify", async () => {
    submitPilotRequest.mockResolvedValue({
      status: "ok",
      requestId: ID,
      isNew: false,
      ownerEmail: "o@x.test",
    });
    expect(await requestPilotAccessAction({}, form())).toEqual({ success: PILOT_REQUEST_RECEIVED_MESSAGE });
    expect(sendPilotNotification).not.toHaveBeenCalled();
  });

  it("reports rate limiting and keeps what was typed", async () => {
    submitPilotRequest.mockResolvedValue({
      status: "rate_limited",
      requestId: null,
      isNew: false,
      ownerEmail: null,
    });
    const r = await requestPilotAccessAction({}, form());
    expect(r.error).toBe(PILOT_RATE_LIMITED_MESSAGE);
    expect(r.values?.building).toBe("agent");
    expect(sendPilotNotification).not.toHaveBeenCalled();
  });

  it("validates server-side before touching the database", async () => {
    const r = await requestPilotAccessAction({}, form({ email: "not-an-email" }));
    expect(r.error).toBeTruthy();
    expect(submitPilotRequest).not.toHaveBeenCalled();
  });

  it("silently drops honeypot submissions", async () => {
    const fd = form();
    fd.set("website", "http://spam.test");
    expect(await requestPilotAccessAction({}, fd)).toEqual({ success: PILOT_REQUEST_RECEIVED_MESSAGE });
    expect(submitPilotRequest).not.toHaveBeenCalled();
  });

  it("asks to retry (does not claim success) when the save itself fails", async () => {
    submitPilotRequest.mockRejectedValue(new Error("db"));
    const r = await requestPilotAccessAction({}, form());
    expect(r.success).toBeUndefined();
    expect(r.error).toMatch(/couldn't save/);
  });
});
