import type { Metadata } from "next";

import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Notion connector — Authority Docs" };

export default function NotionConnectorPage() {
  return (
    <DocsPage title="Notion" description="A fixed, audited set of operations against Notion's own API.">
      <DocsSection title="Connection setup">
        <p>
          An admin connects at <code>/app/integrations/notion</code>: name and an internal integration token —
          one combined &quot;Save and verify&quot; step that immediately checks the token against
          Notion&apos;s API before marking the connection verified. Create the integration at
          notion.so/my-integrations, then share the specific pages or databases agents should reach with it
          via Notion&apos;s own &quot;Connections&quot; menu on each page — an unshared page or database is
          invisible to this connector no matter what the token can otherwise do.
        </p>
        <p>
          No connection-broker support — the token is stored server-side (Vault-backed) once, through this
          dashboard flow; there is no per-application broker protocol for Notion.
        </p>
      </DocsSection>

      <DocsSection title="Supported operations">
        <DocsTable
          headers={["Operation", "Arguments", "Effect", "Approval"]}
          rows={[
            ["notion.retrieve_page", "page_id", "read", "—"],
            ["notion.query_database", "database_id", "read", "—"],
            ["notion.create_page", "database_id, title", "write", "—"],
          ]}
        />
      </DocsSection>

      <DocsSection title="Why a connector, not a Custom API operation">
        <p>
          Notion&apos;s page-creation body nests fields inside a <code>parent</code> object and a{" "}
          <code>properties.&lt;name&gt;.title[0].text.content</code> path — the Custom API connector&apos;s
          flat, one-field-one-top-level-key body model (see its own docs) cannot express that shape at all.
          This connector builds that exact nested request from fixed, registry-authored code instead, with
          only the validated <code>database_id</code> and <code>title</code> arguments substituted in.
        </p>
      </DocsSection>

      <DocsSection title="A real limitation of create_page">
        <p>
          <code>create_page</code> writes its title into a property literally named <strong>Name</strong> —
          the default title-column name Notion gives every new database. A database whose title column was
          renamed will reject (or silently miscategorize) a page created this way; there is no way to discover
          a database&apos;s actual title-property name from the fixed arguments this operation accepts today.
        </p>
      </DocsSection>

      <DocsSection title="Granted by the token, never used by Authority">
        <p>
          A shared integration can read and write everything about the pages/databases it was shared with —
          every property, every block of content, child pages. The connector&apos;s code has no request-
          building path for any of that beyond the three operations above.
        </p>
      </DocsSection>

      <DocsSection title="Resource binding">
        <p>
          <code>page_id</code>/<code>database_id</code> identifies the resource a capability binds to — a
          capability authorized for one page or database cannot be replayed against a different one (
          <code>RESOURCE_MISMATCH</code>).
        </p>
      </DocsSection>

      <DocsSection title="Current limitations">
        <p>
          Reconciliation for an indeterminate <code>create_page</code> is not yet automatic — Notion has no
          safe way to look up &quot;the page I was about to create&quot; without risking a false match against
          an unrelated, pre-existing page, so an indeterminate create always resolves manually today.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
