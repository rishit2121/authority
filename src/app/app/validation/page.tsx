import Link from "next/link";

import { EnvironmentForm } from "@/components/validation/EnvironmentForm";
import { StatusPill } from "@/components/validation/Pill";
import { fmtTime } from "@/components/validation/labels";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { environmentSpecSchema } from "@/lib/validation/schema";

import { canRunValidation } from "./access";

export default async function EnvironmentsPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/validation");
  const { data: envs } = await context.supabase
    .from("validation_environments")
    .select("id, name, spec, status, expires_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const { count: campaigns } = await context.supabase
    .from("validation_campaigns")
    .select("id", { count: "exact", head: true });
  const now = Date.now();

  return (
    <div className="flex flex-col gap-space-lg">
      {(envs ?? []).length === 0 ? (
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-space-lg">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">Start here</h2>
          <ol className="mt-1 list-decimal pl-5 font-body-sm text-body-sm text-on-surface-variant">
            <li>Create an environment below (limits and expiry for your sandboxes).</li>
            <li>
              Open the{" "}
              <Link className="text-primary underline" href="/app/validation/campaigns/new">
                Campaign builder
              </Link>{" "}
              and run the <strong>Starter pack</strong>.
            </li>
            <li>Inspect what was contained, review any finding, and accept a remediation to verify it.</li>
          </ol>
        </section>
      ) : null}

      <div className="grid gap-space-lg lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Environments" className="flex flex-col gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">Environments</h2>
          {(envs ?? []).map((e) => {
            const spec = environmentSpecSchema.safeParse(e.spec);
            const expired = Date.parse(e.expires_at) <= now;
            return (
              <article
                key={e.id}
                className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-md"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-body-md text-body-md text-on-surface">{e.name}</span>
                  <StatusPill status={expired ? "expired" : e.status} />
                </div>
                <div className="font-mono-code text-[11px] text-outline">
                  expires {fmtTime(e.expires_at)}
                  {spec.success
                    ? ` · max ${spec.data.limits.maxRuns} runs · ${spec.data.limits.maxCampaignMs / 1000}s campaign limit · ${spec.data.sandboxMinutes} min sandboxes`
                    : ""}
                </div>
                <div className="font-mono-code text-[11px] text-outline">
                  synthetic users, agents and tasks · mock GitHub · scripted semantic provider · no network
                  egress
                </div>
              </article>
            );
          })}
          {(envs ?? []).length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant">No environments yet.</p>
          ) : null}
          <p className="font-mono-code text-[11px] text-outline">{campaigns ?? 0} campaign(s) recorded</p>
        </section>
        <EnvironmentForm disabled={!canRunValidation(identity.role)} />
      </div>
    </div>
  );
}
