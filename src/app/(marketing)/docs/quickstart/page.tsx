import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { installCommand, quickstartSnippet, RUN_COMMAND } from "@/lib/setup/quick-setup";

export const metadata: Metadata = { title: "Quickstart — Authority Docs" };

// Rendered per request so the commands show this deployment's own URL, never a build-time guess.
export const dynamic = "force-dynamic";

export default function QuickstartPage() {
  const baseUrl = publicBaseUrl() ?? "https://<your-authority-url>";
  return (
    <DocsPage
      title="Quickstart"
      description="From a new account to an agent making its first least-privilege call, in about five minutes. Everything here also lives on the Setup page inside the app."
    >
      <DocsSection title="1. Get access and create an account">
        <p>
          Authority is an invite-only developer pilot. <Link href="/request-access">Request access</Link> --
          approval is manual, and we&apos;ll reach out if there&apos;s a fit. Once you&apos;re approved,{" "}
          <Link href="/signup">sign up</Link> with the <strong>same email address</strong> and confirm it from
          the link we send. You land on <strong>Setup</strong>, which walks you through the same three steps
          below and checks each one off as you finish it.
        </p>
        <p>
          Signing up with a different address, or before you&apos;re approved, shows an
          &quot;invite-only&quot; page instead of the console. Your application&apos;s own customers never
          need pilot access: they use your backend and agent credentials, not an Authority account.
        </p>
      </DocsSection>

      <DocsSection title="2. Connect a service">
        <p>
          Pick a service on the Setup page — Slack, Gmail, GitHub, Notion, Linear, Stripe, PostgreSQL, or any
          HTTPS API. Each one asks only for what it needs (a bot token, an API key, or a Google sign-in) and
          verifies it right away. Credentials are stored encrypted and never shown again.
        </p>
      </DocsSection>

      <DocsSection title="3. Create your agent">
        <p>
          Give your agent a name and click <strong>Create agent and keys</strong>. Authority creates the
          agent, lets it use the services you picked, and shows a <code>.env</code> block with two keys —{" "}
          <strong>copy it right away</strong>, it&apos;s shown once:
        </p>
        <CodeBlock
          code={`AUTHORITY_URL=${baseUrl}
AUTHORITY_BACKEND_API_KEY=authority_dk_...
AUTHORITY_AGENT_ID=...
AUTHORITY_AGENT_RUNTIME_KEY=authority_rk_...`}
        />
        <p>
          New applications start with <strong>Require task sessions</strong> on: your agent opens a session
          for each task (the snippet below does), and its runtime key alone is refused on your tasks. Nothing
          waits for a person unless you add an approval rule.
        </p>
      </DocsSection>

      <DocsSection title="One-time setup vs. what your code does">
        <DocsTable
          headers={["Once, in the dashboard", "Every task, from your code"]}
          rows={[
            [
              "Connect services; share them with your app (Setup does this)",
              "Create a task for a user: backend.tasks.create",
            ],
            [
              "Create the agent and keys",
              "Prepare it: backend.tasks.prepare -- Authority plans and compiles the contract",
            ],
            [
              "Optional: approval rules (Approvals page)",
              'If a rule matched: wait for status "active" (backend.contracts.getStatus)',
            ],
            [
              "Optional: task alignment and content screening (Settings → Applications)",
              "Open a task session: agent.sessions.create",
            ],
            [
              "Require task sessions (on for new applications)",
              "List permitted tools, then execute: agent.tools.list, agent.tools.execute",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="4. Run your first task">
        <p>Install the SDK (Node 20 or newer):</p>
        <CodeBlock code={installCommand(baseUrl)} />
        <p>
          Save this as <code>quickstart.mjs</code> next to your <code>.env</code>:
        </p>
        <CodeBlock
          code={quickstartSnippet("List the channels in our Slack workspace")}
          language="javascript"
        />
        <p>Run it:</p>
        <CodeBlock code={RUN_COMMAND} />
        <p>
          The flow:{" "}
          <strong>
            create task → prepare → handle approval (only if a rule matched) → create a task session → fetch
            the permitted tools → execute → read the receipt
          </strong>
          . Authority drafts a plan, grants only the tools that plan needs, and your agent can call those
          tools — and nothing else. Each executed call returns a <code>receiptId</code>; every call shows up
          under <strong>Activity</strong>.
        </p>
        <p>
          If <code>delivery</code> is <code>&quot;held&quot;</code>, the action <strong>already ran</strong>{" "}
          and only its result is being withheld for review — never execute it again. See{" "}
          <Link href="/docs/results-and-evaluation">Results</Link>.
        </p>
      </DocsSection>

      <DocsSection title="Next steps">
        <ul className="list-disc pl-5">
          <li>
            <Link href="/docs/authorize-and-execute">Authorize and execute</Link> — what happens on every tool
            call.
          </li>
          <li>
            <Link href="/docs/approvals-and-replanning">Approvals and replanning</Link> — approval rules, and
            retrying with the same idempotency key.
          </li>
          <li>
            <Link href="/docs/task-alignment">Task alignment</Link> — optional checks that a plan and its
            values match what the user asked for.
          </li>
          <li>
            <Link href="/docs/customer-connections">Customer connections</Link> — let each of your own users
            connect their own accounts.
          </li>
          <li>
            <Link href="/docs/http-walkthrough">HTTP walkthrough</Link> — the same flow as raw HTTP calls,
            step by step.
          </li>
        </ul>
      </DocsSection>
    </DocsPage>
  );
}
