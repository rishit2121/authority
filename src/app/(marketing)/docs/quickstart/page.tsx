import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection } from "@/components/docs/DocsPage";
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
      <DocsSection title="1. Create an account">
        <p>
          <Link href="/signup">Sign up</Link>. You land on <strong>Setup</strong>, which walks you through the
          same three steps below and checks each one off as you finish it.
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
          With <strong>Run read-only tools automatically</strong> on (the default), tasks that only read run
          immediately. Anything that writes, sends email, or moves money still waits for you on the{" "}
          <strong>Approvals</strong> page.
        </p>
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
          You describe the task in plain English. Authority drafts a plan, grants only the tools that plan
          needs, and your agent can call those tools — and nothing else. A call to any other tool is refused
          before it reaches the service. The Setup page turns green as soon as your first call arrives, and
          every call shows up under <strong>Activity</strong>.
        </p>
      </DocsSection>

      <DocsSection title="Next steps">
        <ul className="list-disc pl-5">
          <li>
            <Link href="/docs/authorize-and-execute">Authorize and execute</Link> — what happens on every tool
            call.
          </li>
          <li>
            <Link href="/docs/approvals-and-replanning">Approvals</Link> — how write actions wait for a human.
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
