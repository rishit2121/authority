import type { Metadata } from "next";

import { InstallationActions, RepositoryToggle } from "@/components/github/GithubControls";
import { ModeBadge } from "@/components/github/ModeBadge";
import { Icon } from "@/components/ui/Icon";
import { EXPECTED_PERMISSIONS } from "@/lib/github/constants";
import { githubReadiness } from "@/lib/github/config";
import { loadGithubOverview } from "@/lib/github/read-model";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = { title: "GitHub integration" };

const ERRORS: Record<string, string> = {
  invalid_state: "The installation link expired or was not started from this browser. Start again.",
  invalid_installation: "GitHub did not report a valid installation.",
  installation_unavailable: "That GitHub installation is not available to this workspace.",
  installation_not_visible:
    "GitHub does not show that installation to your GitHub account, so it was not connected.",
  already_connected: "This workspace already has a GitHub installation. Disconnect it first.",
  forbidden: "Connecting GitHub requires the admin role.",
  connector_disabled: "The GitHub connector is not enabled on this deployment.",
  not_configured: "The GitHub connector is not fully configured on this deployment.",
  rate_limited: "Too many installation attempts are pending. Wait a few minutes.",
  verification_failed: "GitHub could not verify the installation.",
};

const STATUS_STYLE: Record<string, string> = {
  active: "border-allow/30 bg-allow/10 text-allow",
  suspended: "border-secondary/40 bg-secondary/10 text-secondary",
  permission_drift: "border-deny/40 bg-deny/10 text-deny",
  disconnected: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export default async function GithubIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/integrations/github");
  const { installation, repositories } = await loadGithubOverview(context.supabase);
  const readiness = githubReadiness();
  const canAdmin = ["admin", "owner"].includes(identity.role);
  const errorMessage = params.error
    ? (ERRORS[params.error] ?? "The installation could not be completed.")
    : null;

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <div className="flex flex-wrap items-center gap-space-sm">
          <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
            GitHub
          </h1>
          <ModeBadge mode={readiness.mode} />
        </div>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Authority connects through a GitHub App, never a personal token. The App holds only the permissions
          below, and every execution mints a short-lived token limited to one repository, kept in memory and
          discarded.
        </p>
      </header>

      {errorMessage ? (
        <div
          role="alert"
          data-testid="github-error"
          className="rounded-lg border border-deny/40 bg-deny/10 px-space-md py-2.5 font-body-md text-body-sm text-deny"
        >
          {errorMessage}
        </div>
      ) : null}
      {params.connected ? (
        <div
          role="status"
          data-testid="github-connected"
          className="rounded-lg border border-allow/30 bg-allow/10 px-space-md py-2.5 font-body-md text-body-sm text-allow"
        >
          GitHub connected and verified.
        </div>
      ) : null}
      {readiness.mode === "live" && !readiness.ready ? (
        <div
          role="alert"
          className="rounded-lg border border-secondary/40 bg-secondary/10 px-space-md py-2.5 font-body-md text-body-sm text-secondary"
        >
          Live GitHub is selected but these deployment variables are missing: {readiness.missing.join(", ")}.
        </div>
      ) : null}

      <section
        aria-labelledby="perm-heading"
        className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      >
        <h2 id="perm-heading" className="font-headline-sm text-headline-sm font-semibold text-on-surface">
          Least-privilege App permissions
        </h2>
        <ul className="mt-space-sm flex flex-wrap gap-2" data-testid="expected-permissions">
          {Object.entries(EXPECTED_PERMISSIONS).map(([k, v]) => (
            <li
              key={k}
              className="rounded border border-outline-variant/40 px-2 py-0.5 font-mono-code text-[12px] text-on-surface-variant"
            >
              {k}: {v}
            </li>
          ))}
        </ul>
        <p className="mt-space-sm font-body-sm text-body-sm text-outline">
          Never requested: administration, secrets, Actions, workflows, webhooks, organization permissions.
          Any extra permission on the installation disables it until removed.
        </p>
      </section>

      {!installation ? (
        <section
          className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-space-lg"
          data-testid="github-not-connected"
        >
          <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Not connected</h2>
          <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
            Install the Authority GitHub App on your account or organization and choose the repositories it
            may reach. You will be sent to GitHub and back; the installation is only recorded after GitHub
            confirms you can see it.
          </p>
          {canAdmin && readiness.mode !== "disabled" ? (
            <form method="post" action="/api/github/connect" className="mt-space-md">
              <button
                type="submit"
                data-testid="github-connect"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed"
              >
                <Icon name="bolt" size={14} /> Connect GitHub
              </button>
            </form>
          ) : (
            <p className="mt-space-md font-body-sm text-body-sm text-outline">
              {readiness.mode === "disabled"
                ? "The connector is disabled on this deployment."
                : "An admin or owner must connect GitHub."}
            </p>
          )}
        </section>
      ) : (
        <section
          aria-labelledby="inst-heading"
          className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
          data-testid="github-installation"
        >
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <h2 id="inst-heading" className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              {installation.accountLogin}{" "}
              <span className="font-body-sm text-outline">({installation.accountType})</span>
            </h2>
            <div className="flex items-center gap-space-sm">
              <ModeBadge mode={installation.mode} />
              <span
                data-testid="installation-status"
                className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_STYLE[installation.status]}`}
              >
                {installation.status.replace("_", " ")}
              </span>
            </div>
          </div>
          <dl className="mt-space-md grid grid-cols-2 gap-space-md sm:grid-cols-4">
            <div>
              <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                Installation
              </dt>
              <dd className="font-mono-code text-[12px] text-on-surface-variant">
                {installation.githubInstallationId}
              </dd>
            </div>
            <div>
              <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                Repository access
              </dt>
              <dd className="text-on-surface-variant">{installation.repositorySelection}</dd>
            </div>
            <div>
              <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                Last verified
              </dt>
              <dd className="text-on-surface-variant">
                {installation.lastVerifiedAt
                  ? new Date(installation.lastVerifiedAt).toLocaleString()
                  : "never"}
              </dd>
            </div>
            <div>
              <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                Granted permissions
              </dt>
              <dd className="font-mono-code text-[11px] text-on-surface-variant">
                {Object.entries(installation.grantedPermissions)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(", ") || "—"}
              </dd>
            </div>
          </dl>
          {installation.healthReasons.length > 0 ? (
            <div
              role="alert"
              data-testid="installation-health-reasons"
              className="mt-space-md rounded-lg border border-deny/40 bg-deny/10 px-space-md py-2 font-body-sm text-body-sm text-deny"
            >
              Execution is disabled for this installation: {installation.healthReasons.join(", ")}. Fix the
              permissions in GitHub (App settings or the installation page), then re-verify.
            </div>
          ) : null}
          <div className="mt-space-md">
            <InstallationActions
              installationRowId={installation.id}
              githubInstallationId={String(installation.githubInstallationId)}
              canAdmin={canAdmin}
            />
          </div>
        </section>
      )}

      {installation ? (
        <section
          aria-labelledby="repo-heading"
          className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
        >
          <h2 id="repo-heading" className="font-headline-sm text-headline-sm font-semibold text-on-surface">
            Repositories
          </h2>
          <p className="mt-1 font-body-sm text-body-sm text-outline">
            Discovered from the installation only. Nothing is usable until you allow it here; a task must then
            be bound to one.
          </p>
          {repositories.length === 0 ? (
            <p className="mt-space-md font-body-md text-body-sm text-on-surface-variant">
              No repositories discovered. Add repositories to the installation on GitHub and re-verify.
            </p>
          ) : (
            <ul className="mt-space-md divide-y divide-outline-variant/20" data-testid="repo-list">
              {repositories.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-space-sm py-2.5"
                  data-testid={`repo-${r.fullName}`}
                >
                  <div>
                    <span className="font-mono-code text-[13px] text-on-surface">{r.fullName}</span>
                    <span className="ml-2 font-body-sm text-body-sm text-outline">
                      {r.isPrivate ? "private" : "public"} · default {r.defaultBranch}
                      {r.archived ? " · archived" : ""}
                      {!r.present ? " · removed from installation" : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-space-sm">
                    <span
                      data-testid={`repo-state-${r.fullName}`}
                      className={`font-mono-code text-[11px] ${r.allowed ? "text-allow" : "text-outline"}`}
                    >
                      {r.allowed ? "allowed" : "not allowed"}
                    </span>
                    <RepositoryToggle
                      repositoryId={r.id}
                      allowed={r.allowed}
                      name={r.fullName}
                      disabled={
                        !canAdmin ||
                        (!r.allowed && (!r.present || r.archived || installation.status !== "active"))
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
