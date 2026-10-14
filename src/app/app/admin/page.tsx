import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/PageHeader";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { connectorLabel } from "@/lib/connectors/catalog";
import { getPlatformMetrics, type DayCount } from "@/lib/gateway/rpc-platform";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = { title: "Metrics" };
export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-paper-raised p-5">
      <div className="text-[13px] text-ink-soft">{label}</div>
      <div className="mt-1 text-[28px] font-semibold tabular-nums text-ink">{value.toLocaleString()}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-ink-soft">{hint}</div> : null}
    </div>
  );
}

function Bars({ title, series }: { title: string; series: DayCount[] }) {
  const max = Math.max(1, ...series.map((d) => d.count));
  const total = series.reduce((sum, d) => sum + d.count, 0);
  return (
    <section className="rounded-[14px] border border-line bg-paper-raised p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <span className="text-[12px] text-ink-soft">{total.toLocaleString()} in 30 days</span>
      </div>
      <div
        className="mt-4 flex h-24 items-end gap-[3px]"
        role="img"
        aria-label={`${title}: ${total} in 30 days`}
      >
        {series.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${d.count}`}
            className="flex-1 rounded-t-sm bg-primary/70"
            style={{
              height: `${Math.max(d.count > 0 ? 6 : 2, (d.count / max) * 100)}%`,
              opacity: d.count ? 1 : 0.25,
            }}
          />
        ))}
      </div>
    </section>
  );
}

function Check({ on }: { on: boolean }) {
  return <span className={on ? "text-allow" : "text-ink-soft/50"}>{on ? "✓" : "–"}</span>;
}

export default async function PlatformMetricsPage() {
  const { identity } = await createRepositoriesForCurrentTenant("/app/admin");
  if (!isPlatformAdmin(identity.email)) notFound();

  const m = await getPlatformMetrics();
  const funnel = [
    { label: "Signed up", value: m.workspaces.total },
    { label: "Connected a service", value: m.workspaces.withConnection },
    { label: "Created an agent", value: m.workspaces.withAgent },
    { label: "Made a call", value: m.workspaces.withCall },
  ];
  const top = Math.max(1, funnel[0].value);

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Metrics"
        description="Real usage across every workspace on this deployment. Test accounts (@authority.test) and sandboxes are excluded."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" value={m.users.total} hint={`${m.users.confirmed} confirmed email`} />
        <Stat label="New users (7 days)" value={m.users.last7d} hint={`${m.users.last30d} in 30 days`} />
        <Stat
          label="Active workspaces (7 days)"
          value={m.workspaces.active7d}
          hint="made at least one call"
        />
        <Stat
          label="Tool calls (7 days)"
          value={m.calls.authorized7d}
          hint={`${m.calls.executed7d} executed · ${m.calls.authorized30d} in 30 days`}
        />
      </div>

      <section className="rounded-[14px] border border-line bg-paper-raised p-5">
        <h2 className="text-[15px] font-semibold text-ink">Setup funnel</h2>
        <ul className="mt-4 flex flex-col gap-2.5">
          {funnel.map((step) => (
            <li key={step.label} className="flex items-center gap-3 text-[13px]">
              <span className="w-40 shrink-0 text-ink">{step.label}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.05]">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${(step.value / top) * 100}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums text-ink">{step.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Bars title="Signups per day" series={m.signupsByDay} />
        <Bars title="Tool calls per day" series={m.callsByDay} />
      </div>

      <section className="rounded-[14px] border border-line bg-paper-raised p-5">
        <h2 className="text-[15px] font-semibold text-ink">Connections by service</h2>
        {Object.keys(m.connectionsByService).length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-soft">No connections yet.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {Object.entries(m.connectionsByService)
              .sort(([, a], [, b]) => b - a)
              .map(([service, n]) => (
                <li key={service} className="rounded-full border border-line px-3 py-1 text-[13px] text-ink">
                  {service === "custom_api"
                    ? "Custom API"
                    : service === "postgres"
                      ? "PostgreSQL"
                      : connectorLabel(service)}{" "}
                  <span className="tabular-nums text-ink-soft">{n}</span>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-[14px] border border-line bg-paper-raised">
        <h2 className="px-5 pt-5 text-[15px] font-semibold text-ink">Recent signups</h2>
        <table className="mt-3 w-full text-left text-[13px]">
          <thead className="border-b border-line text-ink-soft">
            <tr>
              <th className="px-5 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Joined</th>
              <th className="px-3 py-2 text-center font-medium">Confirmed</th>
              <th className="px-3 py-2 text-center font-medium">Connected</th>
              <th className="px-3 py-2 text-center font-medium">Agent</th>
              <th className="px-5 py-2 text-center font-medium">First call</th>
            </tr>
          </thead>
          <tbody>
            {m.recentSignups.map((u) => (
              <tr key={`${u.email}-${u.createdAt}`} className="border-b border-line last:border-0">
                <td className="px-5 py-2.5 text-ink">{u.email}</td>
                <td className="px-3 py-2.5 text-ink-soft">
                  {new Date(u.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Check on={u.confirmed} />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Check on={u.hasConnection} />
                </td>
                <td className="px-3 py-2.5 text-center">
                  <Check on={u.hasAgent} />
                </td>
                <td className="px-5 py-2.5 text-center">
                  <Check on={u.hasCall} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.recentSignups.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-ink-soft">No signups yet.</p>
        ) : null}
      </section>

      <p className="text-[12px] text-ink-soft">
        Updated {new Date(m.generatedAt).toLocaleString()} · refresh the page for the latest numbers.
      </p>
    </div>
  );
}
