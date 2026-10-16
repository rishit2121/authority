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
              "One of your approval rules matched, so a person must approve it first -- see below. Response includes approvalPath.",
            ],
            [
              "alignment_review",
              "Task alignment is enforced and the plan did not clear: decision is revise (fix the plan) or hold (a person reviews it). Includes alignment findings.",
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

      <DocsSection title="When a task needs approval">
        <p>
          By default, none does: a contract activates as soon as it is compiled, and every call your agent
          makes is still checked against it. Approval is your organization&apos;s call -- add a rule on the
          dashboard&apos;s <strong>Approvals</strong> page (for example &quot;money movement&quot;, a service
          such as Stripe, or one specific tool) and any task whose plan includes a matching operation waits
          there for a person instead.
        </p>
        <p>
          Rules are matched against trusted registry metadata for each operation the contract includes, never
          against anything the caller asserts. A rule only decides <em>whether a person signs off</em>; it
          never changes what a contract allows.
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
// outcome.status: "ready" | "awaiting_approval" | "alignment_review" | "clarification" | "rejected" | "ai_unavailable"
// outcome.checks.planReview: "ran" | "not_run"`}
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
              "Does skipping approval widen what a task may do?",
              "No -- the compiled contract's allowed actions are always scoped to exactly the submitted plan's tools, whether or not a person approved it.",
            ],
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}
