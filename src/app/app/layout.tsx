import type { Metadata } from "next";
import { headers } from "next/headers";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { initialsFor } from "@/lib/auth/identity";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { demoDataEnabled } from "@/lib/demo-data";
import { loadNavBadges } from "@/lib/data/nav";
import { getJevSettings } from "@/lib/jev/persistence";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = {
  title: "Control plane",
};

/**
 * The protected boundary.
 *
 * `requireIdentity()` verifies the user against the Auth server, completes
 * onboarding if needed, and resolves the active tenant from the user's real
 * memberships. It redirects to `/login` when there is no session, so nothing
 * below this layout renders for an unauthenticated request.
 *
 * The middleware also gates `/app`, but this check is not redundant: a matcher
 * is a pattern, and the authorization decision belongs next to the data it
 * protects rather than at the edge.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The path being requested, so a redirect to /login can return the user here
  // afterwards. `x-invoke-path` is not available in layouts, so this falls
  // back to the referer-independent default inside requireIdentity.
  const headerList = await headers();
  const requestedPath = headerList.get("x-authority-path") ?? "/app";

  // Also re-verifies the caller and resolves their real tenant — the same
  // check requireIdentity() does, cached per request, so this costs nothing
  // extra. The badge counts below must come from this tenant's own Supabase
  // rows: passing no repositories here would silently fall back to
  // loadNavBadges()'s mock defaults on every authenticated request, which is
  // exactly the "silent mock fallback under /app/*" this project forbids.
  const { identity, repositories, context } = await createRepositoriesForCurrentTenant(requestedPath);

  const badges = await loadNavBadges(repositories, identity.tenant.tenantId);

  // Read-only, for the sidebar's "Jev · advisory" label — never implies Jev enforces anything
  // when it's actually in shadow mode, and never widens or changes any mode itself.
  const jevSettings = await getJevSettings(context, identity.tenant.tenantId).catch(() => ({
    necessityMode: "off" as const,
    riskMode: "off" as const,
    enforcementApproved: false,
  }));

  return (
    <DashboardShell
      badges={badges}
      jevAdvisory={jevSettings.necessityMode !== "off" || jevSettings.riskMode !== "off"}
      identity={{
        displayName: identity.displayName,
        email: identity.email,
        initials: initialsFor(identity.displayName, identity.email),
        role: identity.role,
        environment: identity.tenant.environment,
        demoDataEnabled: demoDataEnabled(),
      }}
      memberships={identity.memberships}
      currentTenantId={identity.tenant.tenantId}
      isPlatformAdmin={isPlatformAdmin(identity.email)}
    >
      {children}
    </DashboardShell>
  );
}
