import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { firstCallSample, SAMPLE_FILE, SAMPLE_RUN_COMMAND } from "@/lib/setup/handoff";
import { installCommand } from "@/lib/setup/quick-setup";
import { READ_CALLS } from "@/lib/setup/state";

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
          On the Setup page, choose your app, then pick a service: Slack (a workspace bot token), Gmail
          (Google account consent), GitHub (the GitHub App installation), Notion, Linear, Stripe, PostgreSQL,
          or any HTTPS API. Each card shows the connections you already have and whether each one is ready,
          needs consent, needs access or needs reconnecting. Credentials are stored encrypted and never shown
          again.
        </p>
        <p>
          Setup then shows <strong>who can use the connection</strong> today, before anything changes. To try
          it, share it with <strong>your test customer only</strong> (one explicit click). Sharing with every
          customer of your app is a separate, optional choice that asks for confirmation; setup never does it
          for you.
        </p>
      </DocsSection>

      <DocsSection title="3. Make a protected call">
        <p>
          For Gmail and Slack, <strong>Make a protected call</strong> runs one fixed read (
          <code>gmail.list_labels</code> or <code>slack.list_channels</code>) through this deployment&apos;s
          own API, exactly as your code will: a task for your test customer with only that connection, a
          one-step plan (no model), a short task session, authorize, execute. You see the decision, its
          reasons and the receipt. Nothing is retried: a timeout after execute is shown as &quot;outcome
          unknown&quot;.
        </p>
        <p>
          The same click issues two keys, shown <strong>once</strong>, as a <code>.env</code> block:
        </p>
        <CodeBlock
          code={`AUTHORITY_URL=${baseUrl}
AUTHORITY_BACKEND_API_KEY=authority_dk_...
AUTHORITY_AGENT_ID=...
AUTHORITY_AGENT_RUNTIME_KEY=authority_rk_...
SLACK_CONNECTION_ID=...`}
        />
        <p>
          New applications start with <strong>Require task sessions</strong> on: your agent opens a session
          for each task, and its runtime key alone is refused on your tasks. Nothing waits for a person unless
          you add an approval rule.
        </p>
      </DocsSection>

      <DocsSection title="One-time setup vs. what your code does">
        <DocsTable
          headers={["Once, in the dashboard", "Every task, from your code"]}
          rows={[
            [
              "Connect services; share each one with the customers who may use it",
              "Prepare a task for one user with exactly the connections it needs: authority.prepareTask",
            ],
            [
              "Create the agent and keys (Setup does this)",
              'Handle every prepare status; only "ready" has a task to call',
            ],
            ["Optional: approval rules (Approvals page)", "Call the planned tools: run.task.call"],
            [
              "Optional: task alignment and content screening (Settings → Applications)",
              "Handle every call status; never auto-retry an indeterminate write",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="4. Use it in your code">
        <p>Install the SDK (Node 20 or newer):</p>
        <CodeBlock code={installCommand(baseUrl)} />
        <p>
          Save this as <code>{SAMPLE_FILE}</code> next to your <code>.env</code> (the Setup page shows the
          same file for the connector you chose):
        </p>
        <CodeBlock
          code={firstCallSample({ baseUrl, call: READ_CALLS.slack, connectionId: "<your connection id>" })}
          language="javascript"
        />
        <p>Run it:</p>
        <CodeBlock code={SAMPLE_RUN_COMMAND} />
        <p>
          Each executed call returns a <code>receiptId</code>; every call shows up under{" "}
          <strong>Activity</strong>. If the result is <code>result_held</code>, the action{" "}
          <strong>already ran</strong> and only its result is being withheld for review: never run it again.
          See <Link href="/docs/results-and-evaluation">Results</Link>.
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
