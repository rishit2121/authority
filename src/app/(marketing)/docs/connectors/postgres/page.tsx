import type { Metadata } from "next";

import { DocsPage, DocsSection } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "PostgreSQL connector — Authority Docs" };

export default function PostgresConnectorPage() {
  return (
    <DocsPage
      title="PostgreSQL"
      description="Every tenant's schema is different, so there is no fixed universal operation — a developer writes a named, parameterized query and an administrator publishes it, exactly like Custom API's operations."
    >
      <DocsSection title="Connection setup">
        <p>
          An admin connects at <code>/app/integrations/postgres</code> with a host/port/database/credential.
          Private network destinations are allowed (unlike Custom API) — your database is expected to live on
          one. A developer then writes a query, an admin publishes it; publishing freezes the SQL forever.
        </p>
        <p>
          No connection-broker support — the database credential is stored server-side (Vault-backed) once,
          through this dashboard flow; there is no per-application broker protocol for PostgreSQL.
        </p>
      </DocsSection>

      <DocsSection title="Execution guarantees">
        <p>
          Parameters bind as a native parameterized query, never string-interpolated. A query declared{" "}
          <code>read</code> is independently rescanned for any data-modifying keyword, including inside a CTE,
          and rejected if found. Every query runs under its own statement timeout.
        </p>
      </DocsSection>

      <DocsSection title="Granted by the connection, never used by Authority">
        <p>
          The database role in your connection string can do anything Postgres itself allows for that role —
          read or write any table, run migrations, drop data. Authority never constructs SQL; it only ever
          runs the exact, published, parameterized query a developer wrote. For defense in depth beyond
          Authority&apos;s own enforcement, use a dedicated least-privilege role for this connection rather
          than reusing an admin credential.
        </p>
      </DocsSection>

      <DocsSection title="Resource binding">
        <p>
          Each published query becomes its own tool (<code>postgres_&lt;id&gt;.&lt;query_slug&gt;</code>);
          whichever of its parameters is marked as identifying the resource is what a capability binds to.
        </p>
      </DocsSection>

      <DocsSection title="One database role, many of your customers">
        <p>
          A PostgreSQL connection is one database credential, not a per-end-user login — there is no OAuth
          onboarding here. Every query runs under the same connection&apos;s role regardless of which customer
          a task runs on behalf of. Delegate the connection to whichever of your customers should be able to
          trigger its published queries (Settings → the connection → Delegations, or the developer API&apos;s
          connection-delegation calls) — the same organization-owned-connection-plus-delegation model Stripe,
          Slack and GitHub repositories all use. Revoking a delegation stops that customer&apos;s access
          immediately; it never touches the underlying database credential.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
