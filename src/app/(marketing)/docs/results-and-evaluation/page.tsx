import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Results and evaluation — Authority Docs" };

export default function ResultsPage() {
  return (
    <DocsPage
      title="Results, troubleshooting and evaluation"
      description="Reading what Authority did, recovering safely, and how the alignment features were evaluated."
    >
      <DocsSection title="Receipts and held delivery">
        <p>
          Every executed call returns <code>result</code>, <code>executionId</code> and a{" "}
          <code>receiptId</code> -- the record that the provider action happened. If <code>delivery</code> is{" "}
          <code>&quot;held&quot;</code>, the action ran and only its result is withheld for review:
        </p>
        <CodeBlock
          language="javascript"
          code={`const r = await agent.tools.execute({ taskId, tool: "gmail.send_email", arguments: args, idempotencyKey: "send-1" });
if (r.status === "executed" && r.delivery === "held") {
  // It ran. Do NOT execute it again -- that would send a second email.
  console.log("sent; result held for review", r.receiptId, r.inspection?.status);
}`}
        />
        <p>
          A <code>504 EXECUTION_INDETERMINATE</code> means the provider may or may not have acted; Authority
          never retries it automatically, and neither should you without checking the provider.
        </p>
      </DocsSection>

      <DocsSection title="Where to look">
        <DocsTable
          headers={["Page", "Shows"]}
          rows={[
            ["Activity", "Every authorize decision, its reason codes and capability."],
            [
              "Task page",
              "The contract, task-alignment findings (which checks ran, each finding and the next action), inspected content.",
            ],
            ["Approvals", "Approval rules, tasks held by a rule, and calls or plans held by task alignment."],
          ]}
        />
        <p>
          Common codes: <code>TASK_SESSION_REQUIRED</code> (open a task session -- see{" "}
          <Link href="/docs/task-sessions#require-task-sessions">Task sessions</Link>),{" "}
          <code>TASK_ALIGNMENT_*</code> (see <Link href="/docs/task-alignment#findings">findings</Link>),{" "}
          <code>ALIGNMENT_STATE_CHANGED</code> (retry the same request), and the full list under{" "}
          <Link href="/docs/errors">Errors</Link>.
        </p>
      </DocsSection>

      <DocsSection title="How alignment was evaluated (and what that does not show)">
        <p>
          The playground&apos;s evaluation harness runs scripted and model-driven attacks through
          Authority&apos;s real paths with sandboxed effects, under variants: alignment off, plan review only,
          content screening only, all checks, and the paper-faithful reference. It reports completed / skipped
          / error counts, unauthorized authorizations and their would-be effects, false blocks, task
          completion, latency and reviewer cost, and keeps input detection separate from execution
          containment.
        </p>
        <p>
          The runs so far are a <strong>small smoke evaluation</strong> on hand-written and AgentDojo-adapted
          cases with a 40-call reviewer budget. They are not evidence of production accuracy or of protection
          against prompt injection in general, and one false-block fix has not yet been re-verified live. Run
          the harness yourself (resumable, with explicit call and token budgets) before relying on these
          features:
        </p>
        <CodeBlock
          language="bash"
          code={`# authority-agent-playground, against an Authority started with ALIGNMENT_MAX_REVIEWER_CALLS=40
EVAL_AUTHORITY_URL=http://localhost:3000 npm run eval:alignment -- --variants=A,D --suites=dev --max-reviewer-calls=40 --label=smoke`}
        />
      </DocsSection>
    </DocsPage>
  );
}
