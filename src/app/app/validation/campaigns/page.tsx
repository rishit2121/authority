import Link from "next/link";

import { AutoRefresh } from "@/components/validation/AutoRefresh";
import { StatusPill } from "@/components/validation/Pill";
import { fmtTime } from "@/components/validation/labels";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { toCampaignView } from "@/lib/validation/read-model";

export default async function CampaignsPage() {
  const { context } = await createRepositoriesForCurrentTenant("/app/validation/campaigns");
  const { data } = await context.supabase
    .from("validation_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  const campaigns = (data ?? []).map(toCampaignView);
  const active = campaigns.filter((c) => c.status === "queued" || c.status === "running");

  return (
    <div className="flex flex-col gap-space-lg">
      <AutoRefresh active={active.length > 0} />
      <section aria-label="Active runs" className="flex flex-col gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">Active runs</h2>
        {active.length === 0 ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Nothing is running.{" "}
            <Link className="text-primary underline" href="/app/validation/campaigns/new">
              Start a campaign
            </Link>
            .
          </p>
        ) : (
          active.map((c) => <Row key={c.id} c={c} />)
        )}
      </section>
      <section aria-label="History" className="flex flex-col gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">History</h2>
        {campaigns
          .filter((c) => !active.includes(c))
          .map((c) => (
            <Row key={c.id} c={c} />
          ))}
      </section>
    </div>
  );
}

function Row({ c }: { c: ReturnType<typeof toCampaignView> }) {
  const metrics = (c.summary as { findings?: number } | null) ?? null;
  return (
    <Link
      href={`/app/validation/campaigns/${c.id}`}
      className="flex flex-col gap-1 rounded-xl border border-outline-variant/30 bg-surface-container p-space-md transition-colors hover:border-outline-variant/70"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-body-md text-body-md text-on-surface">{c.name}</span>
        <StatusPill status={c.status} />
      </div>
      <div className="font-mono-code text-[11px] text-outline">
        {fmtTime(c.createdAt)} · {c.progress.done}/{c.progress.total} runs · seed {c.seed}
        {metrics?.findings !== undefined ? ` · ${metrics.findings} finding(s)` : ""}
      </div>
    </Link>
  );
}
