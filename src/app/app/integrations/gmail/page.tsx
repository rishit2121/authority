import type { Metadata } from "next";

import { Icon } from "@/components/ui/Icon";
import { missingGoogleOAuthConfig } from "@/lib/connectors/gmail/config";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import { ConnectConnectionForm, ConnectionCard } from "./GmailControls";

export const metadata: Metadata = { title: "Gmail connector" };

const STATUS_STYLE: Record<string, string> = {
  active: "border-allow/30 bg-allow/10 text-allow",
  suspended: "border-secondary/40 bg-secondary/10 text-secondary",
  needs_attention: "border-deny/40 bg-deny/10 text-deny",
  disconnected: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "That request didn't come from this deployment. Try connecting again.",
  invalid_connection: "That connection could not be found. Try connecting again.",
  connection_not_found: "That connection was not found or is disconnected.",
  not_started_here: "That sign-in didn't start from this browser. Try connecting again.",
  invalid_state: "That sign-in session expired or was tampered with. Try connecting again.",
  oauth_denied: "Google sign-in was cancelled or denied.",
  oauth_exchange_failed: "Google didn't accept that sign-in. Try connecting again.",
};

function friendlyGmailError(code: string, canAdmin: boolean): string {
  if (code === "not_configured") {
    const missing = missingGoogleOAuthConfig();
    return canAdmin
      ? `Gmail isn't configured for this deployment yet. Set ${missing.join(" and ")} in the server environment (or GMAIL_FIXTURE_MODE=1 for local testing), then try again.`
      : "Gmail isn't configured for this deployment yet. Ask an administrator to set it up.";
  }
  return ERROR_MESSAGES[code] ?? "Something went wrong connecting to Google. Try connecting again.";
}

export interface GmailConnectionRow {
  id: string;
  name: string;
  status: string;
  environment: string;
  oauthConnected: boolean;
}

export default async function GmailIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/integrations/gmail");
  const canAdmin = ["admin", "owner"].includes(identity.role);

  const [{ data: connections }, { data: secrets }] = await Promise.all([
    context.supabase
      .from("connector_connections")
      .select("id, name, status, environment")
      .eq("connector_id", "gmail")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("connector_connection_secrets")
      .select("connection_id, secret_type")
      .eq("secret_type", "oauth_refresh_token"),
  ]);
  const connectedIds = new Set((secrets ?? []).map((s) => s.connection_id));

  const rows: GmailConnectionRow[] = (connections ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    environment: c.environment,
    oauthConnected: connectedIds.has(c.id),
  }));

  const error = typeof params.error === "string" ? params.error : null;

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Gmail
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Send one email to a named recipient from the connected Google account — always requires human review
          first, unconditionally, because it leaves the organization.
        </p>
      </header>

      <div
        role="note"
        className="flex items-start gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2.5"
      >
        <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-outline" />
        <p className="font-body-md text-body-sm text-on-surface-variant">
          Gmail uses Google&apos;s own OAuth consent screen, not a pasted credential — Authority never sees
          your password. Only a long-lived refresh token is stored, in Supabase Vault; a short-lived access
          token is requested fresh for every send and never persisted.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-deny/40 bg-deny/10 px-space-md py-2.5 font-body-sm text-body-sm text-deny"
        >
          {friendlyGmailError(error, canAdmin)}
        </div>
      ) : null}

      {canAdmin ? <ConnectConnectionForm /> : null}

      {rows.length === 0 ? (
        <section
          className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-space-lg"
          data-testid="gmail-not-connected"
        >
          <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
            No connections yet
          </h2>
          <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
            {canAdmin
              ? "Create a connection above, then connect it to a Google account."
              : "An admin has not connected Gmail yet."}
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-space-md">
          {rows.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              statusStyle={STATUS_STYLE[connection.status] ?? STATUS_STYLE.disconnected}
              canAdmin={canAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
