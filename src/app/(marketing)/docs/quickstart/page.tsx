import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Quickstart — Authority Docs" };

export default function QuickstartPage() {
  return (
    <DocsPage
      title="Quickstart"
      description="Connect your own agent to Authority in about ten minutes, using a throwaway GitHub repository. Do the whole thing as an admin or owner — a few steps below (connecting GitHub, allowing a repository, activating a contract) specifically require that role."
    >
      <DocsSection title="Prefer code over curl?">
        <p>
          Everything below is the raw HTTP API, one <code>curl</code> at a time, useful for seeing exactly
          what each call does. The canonical, code-based equivalent — create a customer, prepare a contract,
          run a tool call, using the typed <code>@authority/sdk</code> client — is{" "}
          <code>examples/connector-quickstart</code> in the repository: one script, one shared flow, for every
          connector (<code>--connector=gmail</code>, <code>github</code>, <code>stripe</code>,{" "}
          <code>slack</code>, <code>postgres</code>, <code>custom-api</code>). A filtered-tool, model-driven
          agent built on the same SDK is at <code>examples/model-driven-agent</code>.
        </p>
      </DocsSection>

      <DocsSection title="1. Connect GitHub">
        <p>
          <code>/app/integrations/github</code> → <strong>Connect GitHub</strong>, install the App on a
          throwaway repository you don&apos;t mind an agent touching. Back on that page, allow the repository
          under <strong>Repositories</strong>.
        </p>
      </DocsSection>

      <DocsSection title="2. Register an agent">
        <p>
          <code>/app/agents</code> → <strong>Register agent</strong>. Name, model, model provider, framework,
          and an owner are all required — they&apos;re just identity for attribution, not configuration that
          changes behavior.
        </p>
      </DocsSection>

      <DocsSection title="3. Create a task">
        <p>
          <code>/app/tasks</code> → <strong>New task</strong>. Pick the agent and a principal, and write a{" "}
          <strong>Trusted objective</strong> (e.g. &quot;Read issue #1 in the throwaway repo&quot;). Creating
          a task authorizes nothing by itself.
        </p>
      </DocsSection>

      <DocsSection title="4. Bind the repository">
        <p>
          On the new task&apos;s page, the <strong>Repository binding</strong> panel lets you pick one allowed
          repository and <strong>Bind to this task</strong>. This is permanent for the task — there is no
          rebinding.
        </p>
      </DocsSection>

      <DocsSection title="5. Propose and activate a read-only contract">
        <p>
          From the task page, <strong>Create authority contract</strong> opens the plan builder with a
          pre-filled example plan. Use <strong>Load the GitHub #991 example</strong> (or edit the JSON
          directly) so the first node is a plain read —{" "}
          <code>
            &#123; &quot;tool&quot;: &quot;github.get_issue&quot;, &quot;expectedSideEffect&quot;:
            &quot;read&quot;, &quot;arguments&quot;: &#123; &quot;issue_number&quot;: &quot;1&quot; &#125;
            &#125;
          </code>{" "}
          — then <strong>Validate</strong>, then <strong>Propose contract</strong>. Back on the task page,{" "}
          <strong>Activate</strong> the proposed contract (admin/owner only). The contract badge should now
          read <strong>Active</strong>.
        </p>
      </DocsSection>

      <DocsSection title="6. Issue the agent runtime key">
        <p>
          On the agent&apos;s own page (<code>/app/agents/&#123;agentId&#125;</code>), the{" "}
          <strong>Credentials</strong> panel → <strong>Issue credential</strong>. Copy the secret immediately
          — it is shown exactly once and Authority never stores or displays it again.
        </p>
      </DocsSection>

      <DocsSection title="7. Set local environment variables">
        <CodeBlock
          code={`AUTHORITY_URL=https://authority-d2zf.onrender.com
AUTHORITY_RUNTIME_KEY=<your-runtime-key>
AUTHORITY_TASK_ID=<your-task-id>
AUTHORITY_REPOSITORY=<owner>/<repo>`}
        />
        <p>
          The task id is in the task page&apos;s URL. Never commit a real runtime key — treat it like any
          other server secret.
        </p>
      </DocsSection>

      <DocsSection title="8. Make one authorization request">
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/authorize" \\
  -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "taskId": "'"$AUTHORITY_TASK_ID"'",
    "tool": "github.get_issue",
    "operation": "get_issue",
    "resource": "'"$AUTHORITY_REPOSITORY"'",
    "arguments": { "issue_number": "1" },
    "idempotencyKey": "quickstart-1"
  }'`}
        />
        <p>
          Expect <code>&quot;status&quot;: &quot;allow&quot;</code>,{" "}
          <code>&quot;guidance&quot;: &#123; &quot;nextStep&quot;: &quot;proceed&quot; &#125;</code>, and a{" "}
          <code>capability.token</code>.
        </p>
      </DocsSection>

      <DocsSection title="9. Execute the allowed read">
        <p>
          <code>github.*</code> tools go through their own dedicated route, not the generic one — see{" "}
          <Link href="/docs/authorize-and-execute">Authorize and execute</Link>.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/github/execute" \\
  -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "capability": "<the capability.token from step 8>",
    "tool": "github.get_issue",
    "operation": "get_issue",
    "resource": "'"$AUTHORITY_REPOSITORY"'",
    "arguments": { "issue_number": "1" },
    "idempotencyKey": "quickstart-1"
  }'`}
        />
      </DocsSection>

      <DocsSection title="10. Find the decision and receipt in the dashboard">
        <p>
          <strong>Tool calls</strong> (<code>/app/runtime</code>) lists every authorization request with its
          final decision and reason codes. The task page&apos;s own <strong>Decision evidence</strong> and{" "}
          <strong>Executions and receipts</strong> panels show the same call with the real GitHub request id.
        </p>
      </DocsSection>

      <DocsSection title="11. Try something outside the contract">
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/authorize" \\
  -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "taskId": "'"$AUTHORITY_TASK_ID"'",
    "tool": "github.read_file",
    "operation": "read_file",
    "resource": "'"$AUTHORITY_REPOSITORY"'",
    "arguments": { "path": ".env", "ref": "main" },
    "idempotencyKey": "quickstart-2"
  }'`}
        />
        <p>
          Expect a denial (<code>guidance.nextStep: &quot;stop&quot;</code>) — this tool was never in the plan
          you activated, so no capability is issued and nothing reaches GitHub.
        </p>
      </DocsSection>

      <DocsSection title="12. Revoke the test key">
        <p>
          Back on the agent&apos;s page, <strong>Revoke</strong> next to the credential, with a reason. Every
          capability already minted from it stops working immediately.
        </p>
      </DocsSection>

      <DocsSection title="Next">
        <p>
          Prefer not to re-send the runtime key on every call?{" "}
          <Link href="/docs/task-sessions">Task sessions</Link> cover the optional, shorter-lived alternative.
          Building a model-driven agent? See <code>examples/model-driven-agent</code> for a tool-call loop
          using the contract-filtered manifest from <Link href="/docs/tool-filtering">Tool filtering</Link>.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
