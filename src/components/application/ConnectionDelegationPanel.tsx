"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  grantConnectionDelegationAction,
  revokeConnectionDelegationAction,
} from "@/app/app/settings/applications/actions";
import { StatusPill } from "@/components/ui/StatusPill";

export interface DelegationRow {
  customerId: string;
  customerLabel: string;
}

export interface OrganizationConnectionRow {
  connectionId: string;
  connectorId: string;
  verifiedAccountRef: string | null;
  status: string;
  delegations: DelegationRow[];
}

export interface CustomerOption {
  id: string;
  label: string;
}

/**
 * Organization-owned connections (created from the dashboard, the way every
 * connector already works) can be explicitly shared with specific
 * customers. Delegating never changes who owns the connection — it only
 * adds one more customer allowed to use it, revocably.
 */
export function ConnectionDelegationPanel({
  applicationId,
  connections,
  customerOptions,
}: {
  applicationId: string;
  connections: OrganizationConnectionRow[];
  customerOptions: CustomerOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});

  function grant(connectionId: string) {
    const customerId = selected[connectionId];
    if (!customerId) return;
    setError(null);
    startTransition(async () => {
      const result = await grantConnectionDelegationAction(applicationId, connectionId, customerId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Could not grant delegation.");
      }
    });
  }

  function revoke(connectionId: string, customerId: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeConnectionDelegationAction(applicationId, connectionId, customerId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Could not revoke delegation.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-paper-raised p-5">
      <h2 className="text-[15px] font-semibold text-ink">Organization connections &amp; delegation</h2>
      <p className="text-[13px] text-ink-soft">
        An organization-owned connection (created from Integrations, the same way every connector already
        works) stays organization-owned — delegating it to a customer only grants that one customer permission
        to use it in their own tasks, and can be revoked at any time.
      </p>
      {error ? (
        <p role="alert" className="text-[13px] text-deny">
          {error}
        </p>
      ) : null}
      {connections.length === 0 ? (
        <p className="text-[13px] text-ink-soft">No organization-owned connections yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {connections.map((conn) => (
            <li
              key={conn.connectionId}
              className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-code text-[12px] text-ink">
                  {conn.connectorId}
                  {conn.verifiedAccountRef ? ` · ${conn.verifiedAccountRef}` : ""}
                </span>
                <StatusPill tone={conn.status === "active" ? "positive" : "muted"}>{conn.status}</StatusPill>
              </div>
              {conn.delegations.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {conn.delegations.map((d) => (
                    <li key={d.customerId} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-ink-soft">Delegated to {d.customerLabel}</span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => revoke(conn.connectionId, d.customerId)}
                        className="font-medium text-deny underline disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {customerOptions.length > 0 ? (
                <div className="flex items-center gap-2">
                  <select
                    value={selected[conn.connectionId] ?? ""}
                    onChange={(e) => setSelected((s) => ({ ...s, [conn.connectionId]: e.target.value }))}
                    className="rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink"
                  >
                    <option value="">Delegate to…</option>
                    {customerOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={pending || !selected[conn.connectionId]}
                    onClick={() => grant(conn.connectionId)}
                    className="rounded-lg border border-line-strong px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-black/[0.03] disabled:opacity-50"
                  >
                    Grant
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
