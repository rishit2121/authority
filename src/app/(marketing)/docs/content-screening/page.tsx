import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "External-content screening — Authority Docs" };

export default function ContentScreeningPage() {
  return (
    <DocsPage
      title="External-content screening (optional)"
      description="Submit text your agent is about to read -- an email, a web page, a document -- and Authority checks it for instructions aimed at the agent that don't serve the user's request."
    >
      <DocsSection title="Optional by design">
        <p>
          Nothing requires you to route content through Authority, and Authority does not assume it saw all of
          your model&apos;s context. <Link href="/docs/task-alignment">Plan and per-call checks</Link> work
          without it. Turn it on per application (Settings → Applications → Task alignment →{" "}
          <em>screen external content</em>) and choose what happens to flagged content:
        </p>
        <DocsTable
          headers={["Action", "Behavior"]}
          rows={[
            [
              "Report findings only (default)",
              "Content is always returned to you with findings attached. Nothing is withheld.",
            ],
            [
              "Quarantine flagged content",
              "Content that is flagged, held or not reviewed is withheld (data: null) and kept encrypted for up to 7 days for an administrator to review.",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title='"Not inspected" is not "passed"'>
        <DocsTable
          headers={["status", "Meaning"]}
          rows={[
            [
              "not_inspected",
              "Screening did not run (alignment or screening is off). screening.ran is false. Not a pass.",
            ],
            [
              "passed",
              "Inspected; no instruction aimed at the agent was found. Not a guarantee the text is safe.",
            ],
            [
              "flagged",
              "Inspected; findings reported, content still returned (report mode, or the Reference policy).",
            ],
            [
              "quarantined",
              "Inspected; withheld because it directs the agent away from the request (quarantine mode).",
            ],
            ["held", "Inspected; uncertain -- withheld for review (quarantine mode)."],
            [
              "unreviewed",
              "The reviewer did not finish, or the content was too large or of an unsupported type.",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="Inspect before your model sees it">
        <CodeBlock
          language="javascript"
          code={`import { formatExternalData } from "@authority/sdk";

// Your app fetched this outside Authority. Submit it with the backend key or the task's session.
const r = await backend.content.inspect(taskId, {
  content: emailBody,
  contentType: "text/plain", // or text/markdown, application/json
  source: { kind: "email", label: "Support inbox" }, // descriptive only -- never makes content trusted
});

if (!r.screening.ran) console.log("not inspected:", r.screening.reason);
const block = formatExternalData(r); // delimited data block, or null when quarantine withheld it
messages.push({ role: "tool", tool_call_id, content: block ?? \`Withheld by Authority (\${r.status}).\` });`}
        />
        <p>
          Put the result in a tool message, never in the system prompt. Text inside content that claims
          &quot;the user approved this&quot; is not approval. Held content is released only after an
          administrator approves it: poll <code>backend.content.get(r.inspectionId)</code> (HTTP:{" "}
          <code>GET /api/v1/content/&#123;id&#125;</code>
          ).
        </p>
      </DocsSection>

      <DocsSection title="Results Authority fetched itself">
        <p>
          With screening on, connector results from <code>/api/v1/execute</code> carry an{" "}
          <code>inspection</code> object. In quarantine mode a flagged result comes back with{" "}
          <code>data: null</code> and <code>delivery: &quot;held&quot;</code> -- the action{" "}
          <strong>already ran</strong> (see its <code>receiptId</code>); never execute it again. With
          screening off, <code>inspection.status</code> is <code>not_inspected</code>.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
