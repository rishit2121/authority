import type { Metadata } from "next";
import { headers } from "next/headers";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { initialsFor, requireIdentity } from "@/lib/auth/identity";
import { loadNavBadges } from "@/lib/data/nav";

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

  const identity = await requireIdentity(requestedPath);

  // Task, agent, policy, integration and approval data is still mocked in this
  // part and is loaded against the demo fixture tenant, not the signed-in
  // user's real tenant. Part 2B replaces this with Supabase-backed
  // AuthorityRepositories.
  const badges = await loadNavBadges();

  return (
    <DashboardShell
      badges={badges}
      identity={{
        displayName: identity.displayName,
        email: identity.email,
        initials: initialsFor(identity.displayName, identity.email),
        role: identity.role,
      }}
      memberships={identity.memberships}
      currentTenantId={identity.tenant.tenantId}
    >
      {children}
    </DashboardShell>
  );
}
