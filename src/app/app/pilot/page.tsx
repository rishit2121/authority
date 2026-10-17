import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui/PageHeader";
import { requireIdentity } from "@/lib/auth/identity";
import { loadPilotViewer } from "@/lib/pilot/viewer";
import { createClient } from "@/lib/supabase/server";

import { addApprovedEmailAction, setPilotGateAction, updatePilotRequestAction } from "./actions";

export const metadata: Metadata = { title: "Pilot access" };
export const dynamic = "force-dynamic";

const STATUSES = ["pending", "approved", "declined"] as const;

const NOTICES: Record<string, string> = {
  ok: "Saved.",
  not_found: "That request no longer exists.",
  invalid_request: "Check the email address and field lengths.",
  invalid: "Invalid request.",
  error: "That didn't save. Try again.",
};

const card = "rounded-[14px] border border-line bg-paper-raised p-5";
const input =
  "w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink focus:border-primary focus:outline-none";
const button =
  "inline-flex h-9 items-center justify-center rounded-lg border border-line-strong px-3 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03]";
const primaryButton =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-fixed";

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? "bg-allow/10 text-allow"
      : status === "declined"
        ? "bg-deny/10 text-deny"
        : status === "pending"
          ? "bg-primary/10 text-primary"
          : "bg-black/[0.04] text-ink-soft";
  return <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}>{status}</span>;
}

export default async function PilotPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; status?: string; tab?: string; notice?: string }>;
}) {
  // Owner only, decided from the verified account in the database. Everyone
  // else gets a 404, and every query and action below re-checks.
  const identity = await requireIdentity("/app/pilot");
  if (!identity.isPilotOwner) notFound();

  const params = await searchParams;
  const supabase = await createClient();
  const [viewer, list, accounts] = await Promise.all([
    loadPilotViewer(supabase),
    supabase.rpc("pilot_admin_list"),
    params.tab === "accounts"
      ? supabase.rpc("pilot_admin_accounts")
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (list.error) throw new Error(`Could not load pilot requests (${list.error.code ?? "unknown"}).`);
  const rows = list.data ?? [];
  const filter = STATUSES.find((s) => s === params.status) ?? null;
  const shown = filter ? rows.filter((r) => r.status === filter) : rows;
  const selected = params.id ? rows.find((r) => r.id === params.id) : undefined;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  const notice = params.notice ? (NOTICES[params.notice] ?? NOTICES.error) : null;

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Pilot access"
        description="Invite-only developer pilot. Approving an email lets that person sign up, confirm their email and onboard normally. Nobody is emailed automatically."
      />

      {notice ? <div className={`${card} py-3 text-[14px] text-ink`}>{notice}</div> : null}

      <section className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="text-[15px] font-semibold text-ink">
            Invite-only gate: {viewer.gateEnabled ? "On" : "Off"}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-soft">
            {viewer.gateEnabled
              ? "Only approved emails (and you) can create a workspace or use the console. Revoking someone blocks their console on their next request."
              : "Off: anyone who signs up can still use the console. Approve the existing accounts you want to keep (Accounts tab) before turning it on — unapproved accounts lose console access."}
          </p>
        </div>
        <form action={setPilotGateAction}>
          <input type="hidden" name="enabled" value={viewer.gateEnabled ? "false" : "true"} />
          <button type="submit" className={viewer.gateEnabled ? button : primaryButton}>
            {viewer.gateEnabled ? "Turn gate off" : "Turn gate on"}
          </button>
        </form>
      </section>

      <nav className="flex flex-wrap gap-2 text-[13px]">
        {[
          { label: `All (${rows.length})`, href: "/app/pilot", active: !filter && params.tab !== "accounts" },
          ...STATUSES.map((s) => ({
            label: `${s[0].toUpperCase()}${s.slice(1)} (${counts[s]})`,
            href: `/app/pilot?status=${s}`,
            active: filter === s,
          })),
          { label: "Accounts", href: "/app/pilot?tab=accounts", active: params.tab === "accounts" },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-full border px-3 py-1 ${t.active ? "border-primary bg-primary/10 text-ink" : "border-line text-ink-soft hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {params.tab === "accounts" ? (
        <section className={card}>
          <h2 className="text-[15px] font-semibold text-ink">Existing Authority accounts</h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            Approve the accounts that should keep access. Nothing is approved automatically.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-ink-soft">
                <tr>
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 pr-4 font-medium">Confirmed</th>
                  <th className="py-2 pr-4 font-medium">Last sign-in</th>
                  <th className="py-2 pr-4 font-medium">Pilot</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(accounts.data ?? []).map((a) => (
                  <tr key={a.pa_email} className="border-t border-line">
                    <td className="py-2 pr-4 text-ink">{a.pa_email}</td>
                    <td className="py-2 pr-4 text-ink-soft">{fmt(a.pa_created_at)}</td>
                    <td className="py-2 pr-4 text-ink-soft">{a.pa_confirmed ? "yes" : "no"}</td>
                    <td className="py-2 pr-4 text-ink-soft">{fmt(a.pa_last_sign_in_at)}</td>
                    <td className="py-2 pr-4">
                      {a.pa_is_owner ? <StatusPill status="owner" /> : <StatusPill status={a.pa_status} />}
                    </td>
                    <td className="py-2">
                      {!a.pa_is_owner && a.pa_status !== "approved" ? (
                        <form action={addApprovedEmailAction}>
                          <input type="hidden" name="email" value={a.pa_email} />
                          <input type="hidden" name="source" value="existing_account" />
                          <button type="submit" className={button}>
                            Approve
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="grid gap-space-lg lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <section className={card}>
            {shown.length === 0 ? (
              <p className="text-[14px] text-ink-soft">No requests here yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-ink-soft">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Name</th>
                      <th className="py-2 pr-4 font-medium">Email</th>
                      <th className="py-2 pr-4 font-medium">Project</th>
                      <th className="py-2 pr-4 font-medium">Building</th>
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-t border-line ${selected?.id === r.id ? "bg-primary/[0.05]" : ""}`}
                      >
                        <td className="py-2 pr-4">
                          <Link
                            href={`/app/pilot?id=${r.id}${filter ? `&status=${filter}` : ""}`}
                            className="font-medium text-ink underline-offset-2 hover:underline"
                          >
                            {r.name ?? "—"}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 text-ink">{r.email}</td>
                        <td className="max-w-[160px] truncate py-2 pr-4 text-ink-soft">{r.company ?? "—"}</td>
                        <td className="max-w-[240px] truncate py-2 pr-4 text-ink-soft">
                          {r.building ?? "—"}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4 text-ink-soft">
                          {fmt(r.last_submitted_at ?? r.created_at)}
                        </td>
                        <td className="py-2">
                          <StatusPill status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="flex flex-col gap-space-lg">
            {selected ? (
              <section className={card}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[16px] font-semibold text-ink">{selected.name ?? selected.email}</h2>
                    <p className="text-[13px] text-ink-soft">{selected.email}</p>
                  </div>
                  <StatusPill status={selected.status} />
                </div>
                <dl className="mt-4 flex flex-col gap-3 text-[13px]">
                  {(
                    [
                      ["Company / project", selected.company],
                      ["What they're building", selected.building],
                      ["How they'd use Authority", selected.usage],
                      ["Services / tools", selected.services],
                      ["Source", selected.source],
                      ["Submitted", `${fmt(selected.submitted_at)} (${selected.submit_count}×)`],
                      ["Decided", fmt(selected.decided_at)],
                      [
                        "Owner notification",
                        selected.notification_status
                          ? `${selected.notification_status}${selected.notification_detail ? ` — ${selected.notification_detail}` : ""}`
                          : "—",
                      ],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-ink-soft">{k}</dt>
                      <dd className="whitespace-pre-wrap break-words text-ink">{v || "—"}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selected.status !== "approved" ? (
                    <form action={updatePilotRequestAction}>
                      <input type="hidden" name="id" value={selected.id} />
                      <input type="hidden" name="status" value="approved" />
                      <button type="submit" className={primaryButton}>
                        Approve
                      </button>
                    </form>
                  ) : (
                    <form action={updatePilotRequestAction}>
                      <input type="hidden" name="id" value={selected.id} />
                      <input type="hidden" name="status" value="declined" />
                      <button type="submit" className={button}>
                        Revoke
                      </button>
                    </form>
                  )}
                  {selected.status === "pending" ? (
                    <form action={updatePilotRequestAction}>
                      <input type="hidden" name="id" value={selected.id} />
                      <input type="hidden" name="status" value="declined" />
                      <button type="submit" className={button}>
                        Decline
                      </button>
                    </form>
                  ) : null}
                  {selected.status !== "pending" ? (
                    <form action={updatePilotRequestAction}>
                      <input type="hidden" name="id" value={selected.id} />
                      <input type="hidden" name="status" value="pending" />
                      <button type="submit" className={button}>
                        Mark pending
                      </button>
                    </form>
                  ) : null}
                </div>
                <form action={updatePilotRequestAction} className="mt-4 flex flex-col gap-2">
                  <input type="hidden" name="id" value={selected.id} />
                  <label className="text-[13px] font-medium text-ink" htmlFor="pilot-notes">
                    Private notes
                  </label>
                  <textarea
                    id="pilot-notes"
                    name="notes"
                    rows={4}
                    maxLength={4000}
                    defaultValue={selected.admin_notes ?? ""}
                    className={input}
                  />
                  <div>
                    <button type="submit" className={button}>
                      Save notes
                    </button>
                  </div>
                </form>
              </section>
            ) : null}

            <section className={card}>
              <h2 className="text-[15px] font-semibold text-ink">Add an approved email</h2>
              <p className="mt-1 text-[13px] text-ink-soft">
                For someone you invited directly. They sign up with this address; no email is sent.
              </p>
              <form action={addApprovedEmailAction} className="mt-3 flex flex-col gap-2">
                <input name="email" type="email" required placeholder="dev@company.com" className={input} />
                <input name="name" placeholder="Name (optional)" maxLength={120} className={input} />
                <input
                  name="notes"
                  placeholder="Private note (optional)"
                  maxLength={4000}
                  className={input}
                />
                <div>
                  <button type="submit" className={primaryButton}>
                    Approve email
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
