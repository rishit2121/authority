import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Task lifecycle (developer API) — Authority Docs" };

export default function TaskLifecyclePage() {
  return (
    <DocsPage
      title="Task lifecycle (developer API)"
      description="Get a customer-scoped task from created to running authority contract without a dashboard click -- for the tasks that are genuinely eligible. One call submits a plan and runs the exact same deterministic pipeline the dashboard's own contract proposal uses."
    >
      <DocsSection title="One call: prepare">
        <p>
          After <Link href="/docs/customer-connections">creating a customer-scoped task</Link>, submit a
          candidate plan and attempt to get a running contract back:
        </p>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/tasks/$TASK_ID/prepare" \\
  -H "Authorization: Bearer $AUTHORITY_BACKEND_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "plan": {
      "schemaVersion": 1,
      "nodes": [{
        "id": "n1", "sequence": 0, "tool": "gmail.list_labels",
        "arguments": {}, "expectedSideEffect": "read"
      }]
    }
  }'`}
        />
        <p>
          Runs validate → solve → compile → derive-approvals → verify -- unchanged from the dashboard&apos;s
          own candidate-plan editor, never a second, weaker pipeline for API-driven callers. Always responds{" "}
          <code>200</code> with a discriminated <code>status</code>:
        </p>
        <DocsTable
          headers={["status", "Meaning"]}
          rows={[
            ["ready", "Activated automatically. Response includes contractId, version, tools."],
            [
              "awaiting_approval",
              "Proposed, waiting on a human (or nothing has allow-listed this task's tools -- see below). Response includes approvalPath.",
            ],
            [
              "clarification",
              "The plan, structured or generated, could not be compiled as given. Includes reason.",
            ],
            ["rejected", "The solver or verifier refused outright. Includes reason."],
            [
              "ai_unavailable",
              "generate: true was set but no model credentials are configured. Never a silent mock.",
            ],
          ]}
        />
        <p>
          <code>awaiting_approval</code> and <code>clarification</code> are expected, ordinary outcomes --
          never errors. Poll <code>GET /api/v1/contracts/&#123;contractId&#125;</code> on an{" "}
          <code>awaiting_approval</code> outcome until <code>status</code> becomes <code>active</code> (a
          human activated it on the dashboard) or <code>rejected</code>.
        </p>
      </DocsSection>

      <DocsSection title="An AI-generated plan, without silently falling back to a mock">
        <p>
          Set <code>&#123; &quot;generate&quot;: true &#125;</code> instead of <code>plan</code> for a
          model-drafted candidate plan from the task&apos;s own trusted intent and the tenant&apos;s available
          tools. If no model credentials are configured, the response is <code>ai_unavailable</code> --
          structured-plan submission always works with no AI key dependency.
        </p>
      </DocsSection>

      <DocsSection title="Bounded automatic activation">
        <p>
          The dashboard remains available for human approvals, and stays the default -- activation requires
          one, unless an admin explicitly allow-lists a tool for this application (Settings → Applications →
          Automation). Even then, a contract activates automatically only when <strong>both</strong> hold,
          checked from the contract row itself, never from anything the caller asserts:
        </p>
        <ol className="list-inside list-decimal">
          <li>
            The contract&apos;s own freshly-recomputed required-approvals list is independently empty -- the
            compiler&apos;s own decision, never a caller-supplied risk label.
          </li>
          <li>Every tool the contract allows is on this application&apos;s automation allowlist.</li>
        </ol>
        <p>
          Allow-listing a tool never grants it anything beyond what the deterministic pipeline already
          decided: it only skips a human clicking “activate” on a contract that was already going to be
          approved. A tool whose own registry permission is shared with siblings a plan doesn&apos;t request
          (an excess- operations case), or whose data is marked sensitive, keeps requiring a human regardless
          of the allowlist -- allow-listing it is a no-op, not a bypass.
        </p>
      </DocsSection>

      <DocsSection title="The TypeScript SDK">
        <p>
          <code className="font-mono-code">@authority/sdk</code> (in-repo, build with{" "}
          <code>npm run sdk:build</code>, not published) wraps all of this in a typed client:
        </p>
        <CodeBlock
          language="typescript"
          code={`import { AuthorityBackendClient } from "@authority/sdk";

const backend = new AuthorityBackendClient({ baseUrl: AUTHORITY_URL, apiKey: BACKEND_KEY });
const customer = await backend.customers.ensure({ externalId: "user_482" });
const task = await backend.tasks.create({
  customerId: customer.customerId,
  agentId,
  intent: "List my Gmail labels",
  connections: [{ connectorId: "gmail", connectionId }],
});
const outcome = await backend.tasks.prepare(task.taskId, {
  plan: { schemaVersion: 1, nodes: [/* ... */] },
});
// outcome.status: "ready" | "awaiting_approval" | "clarification" | "rejected" | "ai_unavailable"`}
        />
        <p>
          See <code>examples/connector-quickstart</code> for a complete, runnable version (idempotent, reuses
          an existing connection across runs) against any of the six connectors from one script (
          <code>node run.mjs --connector=gmail</code>, <code>--connector=github</code>, <code>stripe</code>,{" "}
          <code>slack</code>, <code>postgres</code>, <code>custom-api</code>), and{" "}
          <code>examples/model-driven-agent</code> for a model-driven agent built on the same client, using{" "}
          <code>AuthorityAgentClient</code> for the session/manifest/authorize/execute side.
        </p>
        <p>
          Every example generates a fresh <code>RUN_ID</code> by default -- a new logical run, with its own
          task and its own contract. A contract&apos;s default one-hour authority window means a stale{" "}
          <code>RUN_ID</code> eventually stops reaching <code>ready</code> again (this schema maps one
          compiled plan identity to exactly one contract, permanently -- it cannot be refreshed in place); set{" "}
          <code>RUN_ID</code> yourself only to resume a specific prior run before that happens.
        </p>
      </DocsSection>

      <DocsSection title="Frequently asked">
        <DocsTable
          headers={["Question", "Answer"]}
          rows={[
            [
              "Does prepare() grant any tool authority by itself?",
              "No. Only an active contract does, and only for exactly the tools it lists -- prepare() decides whether one gets created and, separately, whether it's eligible to activate without a human.",
            ],
            [
              "Can I resubmit the same plan safely?",
              "Yes -- pass the same idempotencyKey and it resolves to the exact same plan and contract, never a duplicate.",
            ],
            [
              "Does allow-listing a tool ever widen what it's permitted to do?",
              "No -- the compiled contract's allowed actions are always scoped to exactly the submitted plan's tools, regardless of automatic activation.",
            ],
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}
