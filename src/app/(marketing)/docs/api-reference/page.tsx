import type { Metadata } from "next";

import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "API reference — Authority Docs" };

const ENDPOINTS: Array<{
  method: string;
  path: string;
  credential: string;
  summary: string;
}> = [
  { method: "POST", path: "/api/v1/sessions", credential: "Runtime key", summary: "Create a task session." },
  {
    method: "GET",
    path: "/api/v1/sessions/current",
    credential: "Session token",
    summary: "Introspect the presented session.",
  },
  {
    method: "POST",
    path: "/api/v1/sessions/revoke",
    credential: "Session token",
    summary: "End the presented session early.",
  },
  {
    method: "GET",
    path: "/api/v1/tasks/{taskId}/tools",
    credential: "Runtime key or session",
    summary: "The task's contract-filtered tool manifest.",
  },
  {
    method: "POST",
    path: "/api/v1/authorize",
    credential: "Runtime key or session",
    summary: "Request permission for one exact tool call.",
  },
  {
    method: "POST",
    path: "/api/v1/execute",
    credential: "Runtime key or session",
    summary: "Execute an authorized non-GitHub tool.",
  },
  {
    method: "POST",
    path: "/api/v1/github/execute",
    credential: "Runtime key or session",
    summary: "Execute an authorized github.* tool.",
  },
  {
    method: "GET",
    path: "/api/v1/approvals/{id}",
    credential: "Runtime key or session",
    summary: "Check an approval's status.",
  },
  {
    method: "POST",
    path: "/api/v1/capabilities/consume",
    credential: "Runtime key or session",
    summary: "Validate a capability without executing anything (simulated).",
  },
  {
    method: "POST",
    path: "/api/v1/capabilities/revoke",
    credential: "Runtime key or session",
    summary: "Revoke one of your own capabilities.",
  },
];

export default function ApiReferencePage() {
  return (
    <DocsPage
      title="API reference"
      description="This page is a map, not the contract. The canonical, machine-readable source of truth is docs/api/OPENAPI.yaml in the repository — every field name and status code on this site is read from the real route handlers, kept in sync with it by hand."
    >
      <DocsSection title="Endpoints">
        <DocsTable
          headers={["Method", "Path", "Credential", "Summary"]}
          rows={ENDPOINTS.map((e) => [
            <code key={`${e.method}-m`}>{e.method}</code>,
            <code key={`${e.method}-${e.path}`}>{e.path}</code>,
            e.credential,
            e.summary,
          ])}
        />
      </DocsSection>

      <DocsSection title="Base URL">
        <p>
          <code>$AUTHORITY_URL/api/v1</code>. See <a href="/docs/quickstart">Quickstart</a> for the hosted
          pilot URL.
        </p>
      </DocsSection>

      <DocsSection title="Nothing here is speculative">
        <p>
          Every endpoint above carries <code>x-status: stable</code> in the OpenAPI spec and is implemented
          exactly as described. The spec reserves an <code>x-status: planned</code> marker for a future
          endpoint that genuinely doesn&apos;t exist yet — check that field before relying on any path you
          don&apos;t see listed above.
        </p>
      </DocsSection>

      <DocsSection title="Idempotency and error shapes">
        <p>
          See <a href="/docs/authorize-and-execute">Authorize and execute</a> for idempotency behavior, and{" "}
          <a href="/docs/errors">Errors and troubleshooting</a> for the full error code list — both are
          endpoint-accurate, not paraphrased from the spec.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
