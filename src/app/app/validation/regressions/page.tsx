import Link from "next/link";

import { StatusPill } from "@/components/validation/Pill";
import { fmtTime } from "@/components/validation/labels";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export default async function RegressionsPage() {
  const { context } = await createRepositoriesForCurrentTenant("/app/validation/regressions");
  const { data } = await context.supabase
    .from("validation_regressions")
    .select("id, scenario_key, description, last_status, last_run_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const failing = rows.filter((r) => r.last_status === "fail" || r.last_status === "error");

  return (
    <div className="flex flex-col gap-space-md">
      <p className="max-w-3xl font-body-sm text-body-sm text-on-surface-variant">
        Every accepted remediation pins the attack that exposed the gap, together with the fix, as an
        immutable regression scenario. If a later change lets that attack through again, it fails here.
      </p>
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono-code text-[12px] text-outline">
            {rows.length - failing.length} of {rows.length} passing
          </span>
          <Link
            className="rounded-lg bg-primary px-3 py-1.5 font-body-sm text-body-sm font-medium text-on-primary"
            href={`/app/validation/campaigns/new?scenarios=${encodeURIComponent(rows.map((r) => r.scenario_key).join(","))}`}
          >
            Rerun all regressions
          </Link>
        </div>
      ) : (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          No regression tests yet. They appear when you accept a remediation.
        </p>
      )}
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex flex-col gap-1 rounded-xl border border-outline-variant/30 bg-surface-container p-space-md"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono-code text-[12px] text-on-surface">{r.scenario_key}</span>
            <StatusPill status={r.last_status ?? "queued"} />
          </div>
          <div className="font-body-sm text-body-sm text-on-surface-variant">{r.description}</div>
          <div className="font-mono-code text-[11px] text-outline">
            last run {fmtTime(r.last_run_at)} · created {fmtTime(r.created_at)}
          </div>
        </div>
      ))}
    </div>
  );
}
