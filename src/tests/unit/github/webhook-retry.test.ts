import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const applyWebhook = vi.fn();
const enqueueWebhookRetry = vi.fn();
vi.mock("@/lib/gateway/rpc-github", async (orig) => ({
  ...((await orig()) as object),
  applyWebhook,
}));
vi.mock("@/lib/maintenance/db", () => ({ enqueueWebhookRetry }));

const SECRET = "mock-webhook-secret";
const body = JSON.stringify({ action: "suspend", installation: { id: 4242 } });
const sign = (b: string) => `sha256=${createHmac("sha256", SECRET).update(b).digest("hex")}`;
const input = (
  over: Partial<{ rawBody: string; signature: string | null; event: string; deliveryId: string }> = {},
) => ({
  rawBody: body,
  signature: sign(body),
  event: "installation",
  deliveryId: "delivery-abcdef-01",
  ...over,
});

describe("webhook processing under failure", () => {
  beforeEach(() => {
    applyWebhook.mockReset();
    enqueueWebhookRetry.mockReset();
    process.env.GITHUB_EXECUTION_MODE = "mock";
    process.env.AUTHORITY_ALLOW_MOCK_GITHUB = "1";
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  it("applies a verified delivery normally", async () => {
    applyWebhook.mockResolvedValue("applied");
    const { processWebhook } = await import("@/lib/github/installation");
    expect(await processWebhook(input())).toEqual({ http: 200, body: { status: "applied" } });
    expect(enqueueWebhookRetry).not.toHaveBeenCalled();
  });

  it("queues a genuine delivery for retry when the database is unavailable", async () => {
    applyWebhook.mockRejectedValue(new Error("db down"));
    enqueueWebhookRetry.mockResolvedValue(undefined);
    const { processWebhook } = await import("@/lib/github/installation");
    const r = await processWebhook(input());
    expect(r).toEqual({ http: 202, body: { status: "queued_for_retry" } });
    expect(enqueueWebhookRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "delivery-abcdef-01",
        event: "installation",
        action: "suspend",
        installationId: "4242",
      }),
    );
  });

  it("surfaces an error (so the operator can redeliver) when even queueing fails", async () => {
    applyWebhook.mockRejectedValue(new Error("db down"));
    enqueueWebhookRetry.mockRejectedValue(new Error("still down"));
    const { processWebhook } = await import("@/lib/github/installation");
    await expect(processWebhook(input())).rejects.toThrow("db down");
  });

  it("never queues an unauthenticated delivery", async () => {
    const { processWebhook } = await import("@/lib/github/installation");
    const r = await processWebhook(input({ signature: "sha256=" + "0".repeat(64) }));
    expect(r.http).toBe(401);
    expect(applyWebhook).not.toHaveBeenCalled();
    expect(enqueueWebhookRetry).not.toHaveBeenCalled();
  });
});
