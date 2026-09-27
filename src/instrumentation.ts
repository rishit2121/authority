/**
 * In-process scheduler for reconciliation (expired capability leases, validation sandboxes, webhook retries,
 * installation re-verification, retention). Runs only in the long-lived Node server. Disable with
 * AUTHORITY_SCHEDULER=off (e.g. when an external cron calls /api/internal/maintenance instead).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AUTHORITY_SCHEDULER === "off") return;
  if (process.env.NODE_ENV !== "production") return;
  const g = globalThis as unknown as { __authoritySchedulerStarted?: boolean };
  if (g.__authoritySchedulerStarted) return;
  g.__authoritySchedulerStarted = true;

  const every = Math.max(60, Math.min(3600, Number(process.env.MAINTENANCE_INTERVAL_SECONDS ?? 300))) * 1000;
  const tick = async () => {
    try {
      const { runMaintenance } = await import("@/lib/maintenance");
      await runMaintenance();
    } catch {
      // Never let the scheduler take the server down; the next tick retries.
    }
  };
  setTimeout(() => void tick(), 30_000).unref();
  setInterval(() => void tick(), every).unref();
}
