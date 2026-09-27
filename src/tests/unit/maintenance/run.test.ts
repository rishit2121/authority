import { beforeEach, describe, expect, it, vi } from "vitest";

const reconcileExpiredReservations = vi.fn();
const applyWebhook = vi.fn();
const sweepValidation = vi.fn();
const refreshInstallation = vi.fn();
const githubReadiness = vi.fn();
const db = {
  dueInstallations: vi.fn(),
  dueWebhookRetries: vi.fn(),
  markWebhookRetry: vi.fn(),
  retentionPurge: vi.fn(),
};

vi.mock("@/lib/gateway/db", () => ({ isGatewayConfigured: () => true }));
vi.mock("@/lib/gateway/rpc-github", () => ({ reconcileExpiredReservations, applyWebhook }));
vi.mock("@/lib/validation/engine/db", () => ({ sweepValidation }));
vi.mock("@/lib/github/config", () => ({ githubReadiness }));
vi.mock("@/lib/github/installation", () => ({ refreshInstallation }));
vi.mock("@/lib/maintenance/db", () => db);

const clearGuard = () => {
  (globalThis as { __authorityMaintenanceRunning?: boolean }).__authorityMaintenanceRunning = false;
};

describe("runMaintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGuard();
    reconcileExpiredReservations.mockResolvedValue(2);
    sweepValidation.mockResolvedValue({ sandboxes: 1, campaigns: 0 });
    db.dueWebhookRetries.mockResolvedValue([]);
    db.markWebhookRetry.mockResolvedValue(undefined);
    db.retentionPurge.mockResolvedValue({
      campaigns: 0,
      webhookDeliveries: 0,
      webhookRetries: 0,
      environments: 0,
    });
    db.dueInstallations.mockResolvedValue([]);
    githubReadiness.mockReturnValue({ mode: "disabled", ready: false, missing: [] });
  });

  it("runs every step and reports what it did", async () => {
    const { runMaintenance } = await import("@/lib/maintenance");
    const r = await runMaintenance();
    expect(r.errors).toEqual([]);
    expect(r.leasesReconciled).toBe(2);
    expect(r.validation).toEqual({ sandboxesDestroyed: 1, campaignsFailed: 0 });
    expect(r.installationsVerified).toBe("skipped");
    expect(r.retention).not.toBeNull();
  });

  it("one failing step never stops the others, and names no error detail", async () => {
    reconcileExpiredReservations.mockRejectedValue(new Error("connection string postgresql://secret"));
    const { runMaintenance } = await import("@/lib/maintenance");
    const r = await runMaintenance();
    expect(r.errors).toEqual(["lease_reconciliation"]);
    expect(r.validation).not.toBeNull();
    expect(r.retention).not.toBeNull();
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("retries queued webhooks: success is marked done, failure backs off without throwing", async () => {
    db.dueWebhookRetries.mockResolvedValue([
      {
        deliveryId: "d-1",
        event: "installation",
        action: "suspend",
        installationId: "1",
        removedRepositoryIds: [],
        attempts: 0,
      },
      {
        deliveryId: "d-2",
        event: "installation",
        action: "deleted",
        installationId: "2",
        removedRepositoryIds: [],
        attempts: 3,
      },
    ]);
    applyWebhook.mockResolvedValueOnce("applied").mockRejectedValueOnce(new Error("db"));
    const { runMaintenance } = await import("@/lib/maintenance");
    const r = await runMaintenance();
    expect(r.webhookRetries).toEqual({ attempted: 2, succeeded: 1, failed: 1 });
    expect(db.markWebhookRetry).toHaveBeenCalledWith("d-1", true, "");
    expect(db.markWebhookRetry).toHaveBeenCalledWith("d-2", false, expect.any(String));
  });

  it("re-verifies live installations, counting drift and per-installation failures", async () => {
    githubReadiness.mockReturnValue({ mode: "live", ready: true, missing: [] });
    db.dueInstallations.mockResolvedValue([
      { rowId: "r1", tenantId: "t1", githubInstallationId: "11" },
      { rowId: "r2", tenantId: "t2", githubInstallationId: "22" },
      { rowId: "r3", tenantId: "t3", githubInstallationId: "33" },
    ]);
    refreshInstallation
      .mockResolvedValueOnce({ status: "ok", health: "active", reasons: [] })
      .mockResolvedValueOnce({
        status: "ok",
        health: "permission_drift",
        reasons: ["PERMISSION_EXTRA:administration"],
      })
      .mockRejectedValueOnce(new Error("github down"));
    const { runMaintenance } = await import("@/lib/maintenance");
    const r = await runMaintenance();
    expect(r.installationsVerified).toEqual({ checked: 2, drifted: 1, failed: 1 });
    expect(refreshInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, tenantId: "t1" }),
    );
  });

  it("skips installation checks when live GitHub is half-configured", async () => {
    githubReadiness.mockReturnValue({ mode: "live", ready: false, missing: ["GITHUB_APP_ID"] });
    const { runMaintenance } = await import("@/lib/maintenance");
    expect((await runMaintenance()).installationsVerified).toBe("skipped");
    expect(db.dueInstallations).not.toHaveBeenCalled();
  });

  it("does not run twice at once", async () => {
    let release: () => void = () => undefined;
    reconcileExpiredReservations.mockImplementation(
      () => new Promise<number>((res) => (release = () => res(0))),
    );
    const { runMaintenance } = await import("@/lib/maintenance");
    const first = runMaintenance();
    await new Promise((r) => setTimeout(r, 10));
    expect((await runMaintenance()).errors).toEqual(["already_running"]);
    release();
    expect((await first).errors).toEqual([]);
  });
});
