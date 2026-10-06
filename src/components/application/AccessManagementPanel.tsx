"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  setApplicationConnectionAccessPolicyAction,
  setBackendCredentialAccessManagementScopeAction,
  type ConnectionAccessScope,
} from "@/app/app/settings/applications/actions";
export interface AccessConnectionRow {
  connectionId: string;
  connectorId: string;
  verifiedAccountRef: string | null;
  scope: ConnectionAccessScope;
}

export interface AccessCredentialRow {
  id: string;
  keyPrefix: string;
  canManageAccess: boolean;
}

const SCOPE_LABEL: Record<ConnectionAccessScope, string> = {
  admin_only: "Admin only (default)",
  backend_grantable: "Backend-grantable",
  application_shared: "Application-shared",
  customer_owned: "Customer-owned",
};

const SCOPE_EXPLANATION: Record<"backend_grantable" | "application_shared" | "admin_only", string> = {
  admin_only:
    "Only an admin, from this dashboard, may grant or revoke which customers can use this connection (the Organization connections panel below). The default, and the only option until you choose otherwise.",
  backend_grantable:
    "Your application's own backend can grant or revoke individual customers' access to this connection from code (AuthorityBackendClient.connections.grantAccess()/revokeAccess()) — no dashboard click per signup. Still per-customer and revocable; the backend can only ever grant access to this one connection, never any other tenant resource.",
  application_shared:
    "Every customer of this application can use this connection immediately — no per-customer grant at all, from the dashboard or from code. Choose this for a connection that genuinely isn't customer-specific (e.g. your own team's Slack workspace or Stripe account that every user shares).",
};

/**
 * Admin configuration for 20261003000020/000021's backend self-service
 * access management: per (application, connection) scope, and which
 * backend credentials may call the resulting grant/revoke API at all.
 * Neither control here grants anything beyond what's explicitly chosen --
 * narrowing a connection back to `admin_only` immediately stops any further
 * backend grant for it (existing delegations are untouched; see the
 * connection_usable_by_customer migration's own comment), and a credential
 * with no can_manage_access scope is refused by the RPC itself, not just
 * hidden here.
 */
export function AccessManagementPanel({
  applicationId,
  connections,
  credentials,
}: {
  applicationId: string;
  connections: AccessConnectionRow[];
  credentials: AccessCredentialRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setScope(connectionId: string, scope: ConnectionAccessScope) {
    setError(null);
    startTransition(async () => {
      const result = await setApplicationConnectionAccessPolicyAction(
        applicationId,
        connectionId,
        scope,
        null,
      );
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Could not set the access policy.");
      }
    });
  }

  function setCanManageAccess(credentialId: string, value: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setBackendCredentialAccessManagementScopeAction(
        applicationId,
        credentialId,
        value,
      );
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Could not update this credential's scope.");
      }
    });
  }

  return (
    <div
      id="access-management"
      className="flex flex-col gap-4 rounded-[10px] border border-line bg-paper-raised p-5"
    >
      <h2 className="text-[15px] font-semibold text-ink">Access management</h2>
      <p className="text-[13px] text-ink-soft">
        Choose how each connection below may be shared with this application&apos;s customers, and which
        backend credentials are trusted to manage that sharing from code. This is the envelope your backend
        operates inside — it can never grant a connection access broader than what you choose here.
      </p>
      {error ? (
        <p role="alert" className="text-[13px] text-deny">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-ink">Connection access scope</h3>
        {connections.length === 0 ? (
          <p className="text-[13px] text-ink-soft">No organization-owned connections yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((conn) => (
              <li
                key={conn.connectionId}
                className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-3.5"
                data-testid={`access-connection-${conn.connectionId}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-code text-[12px] text-ink">
                    {conn.connectorId}
                    {conn.verifiedAccountRef ? ` · ${conn.verifiedAccountRef}` : ""}
                  </span>
                  <select
                    value={conn.scope === "customer_owned" ? "admin_only" : conn.scope}
                    disabled={pending}
                    onChange={(e) => setScope(conn.connectionId, e.target.value as ConnectionAccessScope)}
                    className="rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink disabled:opacity-50"
                    data-testid={`access-scope-select-${conn.connectionId}`}
                  >
                    <option value="admin_only">{SCOPE_LABEL.admin_only}</option>
                    <option value="backend_grantable">{SCOPE_LABEL.backend_grantable}</option>
                    <option value="application_shared">{SCOPE_LABEL.application_shared}</option>
                  </select>
                </div>
                <p className="text-[12px] text-ink-soft">
                  {SCOPE_EXPLANATION[conn.scope === "customer_owned" ? "admin_only" : conn.scope]}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-[13px] font-semibold text-ink">
          Backend credentials with access-management scope
        </h3>
        <p className="text-[12px] text-ink-soft">
          Only a credential checked here may call the grant/revoke-access API at all — every credential starts
          unchecked. An agent runtime key or task session is never eligible; this applies only to backend
          credentials.
        </p>
        {credentials.length === 0 ? (
          <p className="text-[13px] text-ink-soft">No backend credentials yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {credentials.map((cred) => (
              <li key={cred.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="font-mono-code text-ink-soft">{cred.keyPrefix}…</span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={cred.canManageAccess}
                    disabled={pending}
                    onChange={(e) => setCanManageAccess(cred.id, e.target.checked)}
                    data-testid={`access-manage-toggle-${cred.id}`}
                  />
                  <span className="text-ink-soft">Can manage access</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
