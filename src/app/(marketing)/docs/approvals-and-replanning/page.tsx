import type { Metadata } from "next";

import Link from "next/link";

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

      <DocsSection title="When a whole task waits: approval rules">
        <p>
          Nothing waits for a person by default. A task&apos;s contract waits only when one of your{" "}
          <strong>approval rules</strong> (Approvals page: a kind of action such as money movement, a service,
          or a specific tool) matches what the plan includes. <code>prepare</code> then returns{" "}
          <code>awaiting_approval</code>; poll <code>GET /api/v1/contracts/&#123;contractId&#125;</code> (SDK:{" "}
          <code>backend.contracts.getStatus</code>) until <code>status</code> is <code>active</code> or{" "}
          <code>rejected</code>.
        </p>
      </DocsSection>

      <DocsSection title="Held by task alignment: approve, then retry the identical call">
        <p>
          With <Link href="/docs/task-alignment">task alignment</Link> enforced, a call can come back held (
          <code>TASK_ALIGNMENT_HELD</code> or <code>TASK_ALIGNMENT_UNREVIEWED</code>). No decision is recorded
          and no budget is spent. An administrator approves that exact review on the task page; then repeat
          the call with the <strong>same idempotency key and arguments</strong> -- the stored review and its
          approval are reused. A different key or different arguments is a new call and is reviewed again.
        </p>
        <CodeBlock
          language="javascript"
          code={`const call = { taskId, tool: "stripe.issue_refund", arguments: { payment_id: "pi_1", amount_cents: 500 }, idempotencyKey: "refund-pi_1" };
let result = await agent.tools.execute(call);
if (result.status === "held_for_review") {
  console.log("Waiting for an administrator:", result.alignment.reviewId);
  // ...after it is approved on the task page:
  result = await agent.tools.execute(call); // same idempotencyKey, same arguments
}`}
        />
      </DocsSection>

      <DocsSection title="Replanning after a value conflict">
        <p>
          If alignment finds the plan disagrees with the request (for example a refund of $500 when the user
          asked for $5), <code>prepare</code> returns <code>status: &quot;alignment_review&quot;</code> with{" "}
          <code>decision: &quot;revise&quot;</code> and the findings. Fix the plan and prepare again -- or ask
          an administrator to approve the exception. Authority never edits your plan for you.
        </p>
        <CodeBlock
          language="javascript"
          code={`let prepared = await backend.tasks.prepare(taskId, { plan });
if (prepared.status === "alignment_review" && prepared.decision === "revise") {
  for (const f of prepared.alignment.findings) console.log(f.type, f.field ?? "", f.explanation);
  // e.g. wrong_amount amount_cents "The request states 5.00 USD; the plan uses 50000"
  prepared = await backend.tasks.prepare(taskId, { plan: correctedPlan });
}
// A held call during execution: result.status === "requires_replan" with result.alignment.feedback.`}
        />
      </DocsSection>
    </DocsPage>
  );
}
