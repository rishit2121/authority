import type { Metadata } from "next";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Approvals and replanning — Authority Docs" };

export default function ApprovalsPage() {
  return (
    <DocsPage
      title="Approvals and replanning"
      description="Some authorize outcomes aren't a flat allow or deny — they tell your agent to wait for a human, rethink its plan, or ask for clarification. Follow guidance.nextStep, not status, to know which."
    >
      <DocsSection title="The five outcomes">
        <DocsTable
          headers={["guidance.nextStep", "Meaning", "What to do"]}
          rows={[
            ["proceed", "Allowed.", "Execute through the correct connector endpoint."],
            [
              "request_approval",
              "A human must approve this exact request before a capability is issued.",
              "Poll the approval, then resubmit the identical authorize call.",
            ],
            [
              "replan",
              "This specific call won't be allowed as constructed; a different plan might be.",
              "Reconsider the approach — don't retry the same call.",
            ],
            [
              "clarify",
              "The request is underspecified for Authority to evaluate.",
              "Resolve the ambiguity (e.g. a missing argument), then re-authorize.",
            ],
            ["stop", "Denied, or retrying would not help.", "Do not retry this exact call."],
          ]}
        />
      </DocsSection>

      <DocsSection title="Requesting approval">
        <p>
          When <code>guidance.nextStep</code> is <code>request_approval</code>, the authorize response
          includes an <code>approval</code> object:
        </p>
        <CodeBlock
          language="json"
          code={`"approval": { "id": "ap1...", "state": "pending", "requiredApprovals": 1, "approvals": 0, "expiresAt": "...", "statusUrl": "/api/v1/approvals/ap1..." }`}
        />
        <p>
          A human resolves it in the dashboard (the task&apos;s <strong>Required approvals</strong> panel, or
          the workspace-wide <strong>Approvals</strong> page). Your agent has no way to approve its own
          request — this is by design.
        </p>
      </DocsSection>

      <DocsSection title="Polling and resubmitting">
        <CodeBlock
          code={`curl -s "$AUTHORITY_URL$STATUS_URL" -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY"`}
          language="bash"
        />
        <CodeBlock
          language="json"
          code={`{ "approvalId": "ap1...", "state": "approved", "requiredApprovals": 1, "approvals": 1, "expiresAt": "...", "reason": null }`}
        />
        <p>
          <code>state</code> is one of <code>pending</code>, <code>approved</code>, <code>rejected</code>,{" "}
          <code>expired</code>, <code>stale</code>, or <code>consumed</code>. The endpoint deliberately
          reveals no approver identity, notes, or evidence — just enough to know what to do next. It is scoped
          to the agent that requested it; another agent or tenant&apos;s approval is{" "}
          <code>404 APPROVAL_NOT_FOUND</code>, the same answer as an unknown id.
        </p>
        <p>
          Once <code>approved</code>, <strong>resubmit the exact same authorize call</strong> (same tool,
          operation, resource, arguments — a new <code>idempotencyKey</code> is fine). Authority re-checks
          everything from scratch before issuing a capability; approval records intent, not a bypass of the
          rest of the pipeline.
        </p>
      </DocsSection>

      <DocsSection title="Never poll forever">
        <p>
          An approval can expire before anyone acts on it. Give your polling loop a maximum wait and treat a
          timeout as &quot;still pending&quot;, not a failure — see <code>awaitApproval()</code> in{" "}
          <code>examples/agent/authority-client.mjs</code>, which times out to{" "}
          <code>&#123; state: &quot;pending&quot;, timedOut: true &#125;</code> rather than guessing.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
