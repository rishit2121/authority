import type { Metadata } from "next";

import { DocsPage, DocsSection } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "GitHub connector — Authority Docs" };

export default function GithubConnectorPage() {
  return (
    <DocsPage
      title="GitHub"
      description="Executes through a dedicated route, not the generic one — see Authorize and execute."
    >
      <DocsSection title="Connection setup">
        <p>
          An admin connects via <code>/app/integrations/github</code> → <strong>Connect GitHub</strong>, which
          installs Authority&apos;s own GitHub App (never a personal access token). After installing, the
          admin allows specific repositories on that same page; a developer or above then binds one allowed
          repository to a task, permanently, from the task&apos;s own <strong>Repository binding</strong>{" "}
          panel.
        </p>
      </DocsSection>

      <DocsSection title="Required permissions">
        <p>
          The App requests exactly <code>contents: write</code>, <code>issues: read</code>,{" "}
          <code>metadata: read</code>, <code>pull_requests: write</code> — nothing else is ever requested
          (administration, secrets, Actions, workflows, and organization permissions are explicitly excluded).
          Unlike every other connector here, GitHub actively verifies this: if the installation&apos;s actual
          permissions ever drift from this exact set, the installation is disabled until an admin removes the
          extra permission and reconnects.
        </p>
      </DocsSection>

      <DocsSection title="Execution endpoint">
        <p>
          <code>POST /api/v1/github/execute</code> — not the generic <code>/api/v1/execute</code>, which
          returns <code>501 OPERATION_NOT_SUPPORTED</code> for any <code>github.*</code> tool.
        </p>
      </DocsSection>

      <DocsSection title="Resource binding and limitations">
        <p>
          A task is bound to exactly one repository, permanently, the first time it is bound — not the first
          time it executes. Every <code>github.*</code> call for that task is checked against that one
          repository; there is no way to rebind. A short-lived installation token, scoped to that one
          repository, is minted per execution and discarded — never cached, never returned to an agent.
        </p>
      </DocsSection>

      <DocsSection title="Live versus mocked verification">
        <p>
          <code>execution.mode</code> is <code>live</code> only in a production deployment; everywhere else it
          is <code>mock</code> — the real App-token-minting and request-building code path still runs, it just
          doesn&apos;t reach GitHub&apos;s real API.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
