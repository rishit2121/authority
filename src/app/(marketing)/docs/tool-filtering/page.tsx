import type { Metadata } from "next";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Tool filtering — Authority Docs" };

export default function ToolFilteringPage() {
  return (
    <DocsPage
      title="Tool filtering"
      description="GET /api/v1/tasks/{taskId}/tools returns exactly the operations the task's active contract currently allows — so your agent (or the model driving it) doesn't have to guess, or hardcode a tool list that drifts from what's actually authorized."
    >
      <DocsSection title="A filtered list is convenience, not authority">
        <p>
          Listing a tool here grants nothing by itself. A handcrafted authorize call for a tool <em>not</em>{" "}
          in this manifest — or a stale, previously-fetched manifest, if the contract changed since — is still
          independently checked and denied by the real{" "}
          <a href="/docs/authorize-and-execute">authorize/execute pipeline</a> exactly as if this endpoint
          didn&apos;t exist. Never skip the authorize call because something appeared in a manifest.
        </p>
      </DocsSection>

      <DocsSection title="Request">
        <CodeBlock
          code={`curl -s "$AUTHORITY_URL/api/v1/tasks/$AUTHORITY_TASK_ID/tools" \\
  -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY"`}
          language="bash"
        />
        <p>
          Accepts either a runtime key or a <a href="/docs/task-sessions">task session</a> token. No active
          contract is a typed <code>409 NO_ACTIVE_CONTRACT</code>, never a silent fallback to every registered
          tool.
        </p>
      </DocsSection>

      <DocsSection title="Response">
        <CodeBlock
          language="json"
          code={`{
  "taskId": "...",
  "contract": { "id": "c1a2...", "version": 3 },
  "versions": { "registry": "github-demo-2026-10-03a", "compiler": "authority-compiler-2026-09-30-8" },
  "manifestHash": "9f2c1e...",
  "tools": [
    {
      "tool": "github.get_issue",
      "description": "read on issue.",
      "inputSchema": { "type": "object", "properties": { "issue_number": { "type": "string" } }, "required": ["issue_number"] },
      "resourceConstraints": [{ "key": "issue_number", "equals": "1" }],
      "maxInvocations": null,
      "requiresApproval": false
    }
  ]
}`}
        />
        <DocsTable
          headers={["Field", "Meaning"]}
          rows={[
            ["tool", "The operation identifier — pass this as-is to authorize."],
            [
              "description",
              "A trusted, server-generated description (side effect, resource type, approval/financial/external-communication flags).",
            ],
            ["inputSchema", "Standard JSON Schema for the operation's arguments — required fields, types."],
            [
              "resourceConstraints",
              "This contract's own constraints on the operation, e.g. pinned to one resource.",
            ],
            ["maxInvocations", "The remaining-uses budget this contract set for the tool, if any."],
            [
              "requiresApproval",
              "Whether this operation needs human approval regardless of arguments — see Approvals.",
            ],
            [
              "manifestHash",
              "Changes whenever the contract, registry, or tool set changes — cheap to compare before re-fetching.",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="Where it comes from">
        <p>
          Built from the task&apos;s active contract&apos;s allowed actions, resolved against the
          tenant&apos;s real registry — the same source <a href="/docs/connectors">the connector guides</a>{" "}
          describe and the same source the MCP bridge (<code>/api/mcp/tasks/&#123;taskId&#125;</code>) uses
          for its own <code>tools/list</code>, if you&apos;re integrating via an MCP-speaking client instead
          of raw HTTP. Draft, retired, disconnected, and cross-tenant operations are never included.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
