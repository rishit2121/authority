import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMaintenance = vi.fn();
vi.mock("@/lib/maintenance", () => ({ runMaintenance }));

const TOKEN = "t".repeat(40);
const post = (auth?: string) =>
  new NextRequest("http://localhost/api/internal/maintenance", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

describe("POST /api/internal/maintenance", () => {
  beforeEach(() => {
    runMaintenance.mockReset();
    runMaintenance.mockResolvedValue({ errors: [], ranAt: "now", durationMs: 1 });
  });
  afterEach(() => {
    delete process.env.MAINTENANCE_TOKEN;
  });

  it("does not exist without a configured token", async () => {
    const { POST } = await import("@/app/api/internal/maintenance/route");
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    process.env.MAINTENANCE_TOKEN = "short";
    expect((await POST(post("Bearer short"))).status).toBe(404);
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong bearer token without running anything", async () => {
    process.env.MAINTENANCE_TOKEN = TOKEN;
    const { POST } = await import("@/app/api/internal/maintenance/route");
    expect((await POST(post())).status).toBe(401);
    expect((await POST(post("Bearer nope"))).status).toBe(401);
    expect((await POST(post(`Bearer ${"x".repeat(40)}`))).status).toBe(401);
    expect((await POST(post(`Basic ${TOKEN}`))).status).toBe(401);
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it("runs maintenance for the right token and reports partial failure as 207", async () => {
    process.env.MAINTENANCE_TOKEN = TOKEN;
    const { POST } = await import("@/app/api/internal/maintenance/route");
    const ok = await POST(post(`Bearer ${TOKEN}`));
    expect(ok.status).toBe(200);
    runMaintenance.mockResolvedValue({ errors: ["webhook_retries"], ranAt: "now", durationMs: 1 });
    const partial = await POST(post(`Bearer ${TOKEN}`));
    expect(partial.status).toBe(207);
    expect(partial.headers.get("cache-control")).toBe("no-store");
  });
});
