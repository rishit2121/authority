import Link from "next/link";

import { SeverityPill, StatusPill } from "@/components/validation/Pill";
import { CAUSE_LABEL, fmtTime } from "@/components/validation/labels";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { toFindingView } from "@/lib/validation/read-model";

const ORDER = ["critical", "high", "medium", "low", "info"];

export default async function FindingsPage() {
  const { context } = await createRepositoriesForCurrentTenant("/app/validation/findings");
  const { data } = await context.supabase
    .from("validation_findings")
    .select("*, validation_campaigns(name)")
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []).map((r) => ({
    finding: toFindingView(r),
    campaignId: r.campaign_id,
    campaign:
      (r as unknown as { validation_campaigns: { name: string } | null }).validation_campaigns?.name ?? "",
  }));
  rows.sort((a, b) => ORDER.indexOf(a.finding.severity) - ORDER.indexOf(b.finding.severity));

  return (
    <div className="flex flex-col gap-space-sm">
      {rows.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          No findings. Run the &ldquo;Hardening gaps&rdquo; pack to see what a weakened configuration lets
          through.
        </p>
      ) : null}
      {rows.map(({ finding: f, campaignId, campaign }) => (
        <Link
          key={f.id}
          href={`/app/validation/campaigns/${campaignId}`}
          className="flex flex-col gap-1 rounded-xl border border-outline-variant/30 bg-surface-container p-space-md transition-colors hover:border-outline-variant/70"
        >
          <div className="flex flex-wrap items-center gap-2">
            <SeverityPill severity={f.severity} />
            <StatusPill status={f.status} />
            <span className="font-body-md text-body-md text-on-surface">{f.title}</span>
          </div>
          <div className="font-body-sm text-body-sm text-on-surface-variant">{f.summary}</div>
          <div className="font-mono-code text-[11px] text-outline">
            {CAUSE_LABEL[f.cause] ?? f.cause} · {f.scenarioKey} · {campaign} · {fmtTime(f.createdAt)}
          </div>
        </Link>
      ))}
    </div>
  );
}
