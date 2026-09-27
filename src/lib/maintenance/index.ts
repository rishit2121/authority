import "server-only";

import { isGatewayConfigured } from "@/lib/gateway/db";
import { reconcileExpiredReservations } from "@/lib/gateway/rpc-github";
import { applyWebhook } from "@/lib/gateway/rpc-github";
import { githubReadiness } from "@/lib/github/config";
import { refreshInstallation } from "@/lib/github/installation";
import { safeLog } from "@/lib/semantic/scrub";
import { sweepValidation } from "@/lib/validation/engine/db";

import { dueInstallations, dueWebhookRetries, markWebhookRetry, retentionPurge } from "./db";

/**
 * Scheduled reconciliation. Every step is idempotent and bounded, and a failure in one step never stops the others.
 * It is safe to run from more than one place (the in-process timer AND an external cron): each operation re-checks its
 * own state in the database, and an in-process guard stops overlapping runs on one instance.
 */

export interface MaintenanceReport {
  ranAt: string;
  durationMs: number;
  leasesReconciled: number | null;
  validation: { sandboxesDestroyed: number; campaignsFailed: number } | null;
  webhookRetries: { attempted: number; succeeded: number; failed: number } | null;
  installationsVerified: { checked: number; drifted: number; failed: number } | "skipped" | null;
  retention: {
    campaigns: number;
    webhookDeliveries: number;
    webhookRetries: number;
    environments: number;
  } | null;
  errors: string[];
}

const state = globalThis as unknown as {
  __authorityMaintenanceRunning?: boolean;
  __authorityLastMaintenance?: MaintenanceReport;
};

export function lastMaintenance(): MaintenanceReport | null {
  return state.__authorityLastMaintenance ?? null;
}

export async function runMaintenance(
  options: { verifyAgeSeconds?: number } = {},
): Promise<MaintenanceReport> {
  const started = Date.now();
  const report: MaintenanceReport = {
    ranAt: new Date().toISOString(),
    durationMs: 0,
    leasesReconciled: null,
    validation: null,
    webhookRetries: null,
    installationsVerified: null,
    retention: null,
    errors: [],
  };
  if (state.__authorityMaintenanceRunning) {
    report.errors.push("already_running");
    return report;
  }
  if (!isGatewayConfigured()) {
    report.errors.push("gateway_not_configured");
    return report;
  }
  state.__authorityMaintenanceRunning = true;
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      report.errors.push(name);
      safeLog(`maintenance: ${name} failed (${error instanceof Error ? error.name : "unknown"})`);
    }
  };

  try {
    await step("lease_reconciliation", async () => {
      report.leasesReconciled = await reconcileExpiredReservations(200);
    });
    await step("validation_sweep", async () => {
      const s = await sweepValidation(50);
      report.validation = { sandboxesDestroyed: s.sandboxes, campaignsFailed: s.campaigns };
    });
    await step("webhook_retries", async () => {
      const due = await dueWebhookRetries(25);
      const r = { attempted: due.length, succeeded: 0, failed: 0 };
      for (const d of due) {
        try {
          await applyWebhook({
            deliveryId: d.deliveryId,
            event: d.event,
            action: d.action,
            githubInstallationId: d.installationId,
            removedRepositoryIds: d.removedRepositoryIds,
          });
          await markWebhookRetry(d.deliveryId, true, "");
          r.succeeded += 1;
        } catch (error) {
          r.failed += 1;
          await markWebhookRetry(
            d.deliveryId,
            false,
            error instanceof Error ? error.name.toLowerCase() : "error",
          ).catch(() => undefined);
        }
      }
      report.webhookRetries = r;
    });
    await step("installation_verification", async () => {
      const gh = githubReadiness();
      if (gh.mode !== "live" || !gh.ready) {
        report.installationsVerified = "skipped";
        return;
      }
      const due = await dueInstallations(options.verifyAgeSeconds ?? 3600, 20);
      const r = { checked: 0, drifted: 0, failed: 0 };
      for (const inst of due) {
        try {
          const health = await refreshInstallation({
            tenantId: inst.tenantId,
            userId: null,
            installationRowId: inst.rowId,
            githubInstallationId: inst.githubInstallationId,
          });
          r.checked += 1;
          if (health.health !== null && health.health !== "active") r.drifted += 1;
        } catch {
          r.failed += 1;
        }
      }
      report.installationsVerified = r;
    });
    await step("retention_purge", async () => {
      report.retention = await retentionPurge(200);
    });
  } finally {
    state.__authorityMaintenanceRunning = false;
    report.durationMs = Date.now() - started;
    state.__authorityLastMaintenance = report;
  }
  return report;
}
