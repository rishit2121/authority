import type { Metadata } from "next";

import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Linear connector — Authority Docs" };

export default function LinearConnectorPage() {
  return (
    <DocsPage
      title="Linear"
      description="A fixed, audited set of operations against Linear's own GraphQL API."
    >
      <DocsSection title="Connection setup">
        <p>
          An admin connects at <code>/app/integrations/linear</code>: name and a personal API key — one
          combined &quot;Save and verify&quot; step that immediately checks the key against Linear&apos;s API
          before marking the connection verified. Create the key from Linear&apos;s own Settings → Account →
          Security &amp; access → Personal API keys.
        </p>
        <p>
          No connection-broker support — the key is stored server-side (Vault-backed) once, through this
          dashboard flow; there is no per-application broker protocol for Linear. No OAuth onboarding either:
          a personal API key acts as the Linear user who created it, not as a separate app identity.
        </p>
      </DocsSection>

      <DocsSection title="Supported operations">
        <DocsTable
          headers={["Operation", "Arguments", "Effect", "Approval"]}
          rows={[
            ["linear.list_issues", "team_id", "read", "—"],
            ["linear.get_issue", "issue_id", "read", "—"],
            ["linear.create_issue", "team_id, title, description", "write", "—"],
          ]}
        />
      </DocsSection>

      <DocsSection title="Why a connector, not a Custom API operation">
        <p>
          Linear exposes a single GraphQL endpoint, not a REST surface — there is no path/method/flat-body
          shape for the Custom API connector to target at all. This connector sends a fixed, registry-authored
          GraphQL query or mutation string per operation (never one an agent or tenant supplies), with only
          the validated arguments substituted in as GraphQL variables.
        </p>
      </DocsSection>

      <DocsSection title="Granted by the key, never used by Authority">
        <p>
          A personal API key can read and write everything that Linear user can see across every team and
          project in the workspace — comments, cycles, projects, other users&apos; issues, workspace settings.
          The connector&apos;s code has no request-building path for any of that; only the three operations
          above are ever sent.
        </p>
      </DocsSection>

      <DocsSection title="Resource binding">
        <p>
          <code>team_id</code>/<code>issue_id</code> identifies the resource a capability binds to — a
          capability authorized for one team or issue cannot be replayed against a different one (
          <code>RESOURCE_MISMATCH</code>).
        </p>
      </DocsSection>

      <DocsSection title="Current limitations">
        <p>
          GraphQL errors (an unknown team or issue id, a malformed filter) ride back on HTTP 200,
          Linear&apos;s own convention — this connector still classifies and settles those as a definite
          failure, never as a silent success. Reconciliation for an indeterminate <code>create_issue</code> is
          not yet automatic: Linear has no safe, idempotent &quot;did my last mutation already happen&quot;
          lookup, so an indeterminate create always resolves manually today.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
