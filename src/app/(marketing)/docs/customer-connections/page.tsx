import type { Metadata } from "next";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Customer connections — Authority Docs" };

export default function CustomerConnectionsPage() {
  return (
    <DocsPage
      title="Customer connections"
      description="Your application has its own end users, each with their own provider account. This is how they connect Gmail, GitHub, or anything else without ever needing an Authority account -- and how a task for one of them can never reach another's connection."
    >
      <DocsSection title="Three things that are not the same">
        <DocsTable
          headers={["Concept", "Answers", "Proven by"]}
          rows={[
            [
              "Application sign-in",
              "Who is Alex, inside your app?",
              "Your own login system -- Authority is never involved.",
            ],
            [
              "Provider authorization",
              "Which Gmail/GitHub account may Acme access, on Alex's behalf?",
              "A connection -- either one Alex authorized directly (embedded), or one your backend already manages (broker).",
            ],
            [
              "Authority task authorization",
              "What may this one agent task actually do, right now?",
              "The task's active contract -- unchanged by anything on this page.",
            ],
          ]}
        />
        <p>
          Signing into your app never grants Gmail permissions. Connecting Gmail never grants every Gmail
          operation an agent could use. The three stay independent on purpose.
        </p>
      </DocsSection>

      <DocsSection title="Customers">
        <p>
          A customer is your own end user, identified by an opaque external id your backend already uses for
          them -- never email, never anything an agent or end user supplies directly. Authority trusts the
          authenticated backend credential presenting that id; it does not re-verify who Alex is in your own
          system. A compromised backend credential is a different threat than a compromised agent, and is
          scoped accordingly -- see <a href="#backend-credential">Backend credential</a> below.
        </p>
        <p>A customer is never a Supabase user: no invitation, no password, no dashboard login, ever.</p>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/customers" \\
  -H "Authorization: Bearer $AUTHORITY_BACKEND_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "externalId": "user_482" }'`}
        />
        <p>
          Idempotent: calling this again with the same <code>externalId</code> always resolves the same
          customer.
        </p>
      </DocsSection>

      <DocsSection title="Mode A: Authority manages a new connection">
        <p>
          For an application with no existing provider connection to reuse. Alex authorizes Gmail directly;
          Authority exchanges and stores the credential server-side.
        </p>
        <ol className="list-inside list-decimal">
          <li>Your backend opens a session for one customer and provider.</li>
          <li>Redirect Alex&apos;s browser to the returned URL.</li>
          <li>Alex authorizes Gmail on Google&apos;s own consent screen.</li>
          <li>
            Authority verifies the account, stores the credential, and redirects back to your allowlisted URL.
          </li>
          <li>Your backend reads the connection status.</li>
        </ol>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/connections/sessions" \\
  -H "Authorization: Bearer $AUTHORITY_BACKEND_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerId": "'"$CUSTOMER_ID"'",
    "connectorId": "gmail",
    "returnUrl": "https://app.acme.com/settings/integrations"
  }'`}
        />
        <p>
          Response includes <code>url</code> (redirect Alex&apos;s browser here) and <code>sessionId</code>{" "}
          (poll with it below). The return URL must exactly match one registered on your application
          (dashboard Settings → your application) -- never a pattern, so this can never become an open
          redirect.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -s "$AUTHORITY_URL/api/v1/connections/sessions/$SESSION_ID" \\
  -H "Authorization: Bearer $AUTHORITY_BACKEND_KEY"`}
        />
        <p>
          <code>status</code> is one of <code>pending</code>, <code>completed</code>, <code>expired</code>,{" "}
          <code>cancelled</code>, or <code>denied</code>. Once <code>completed</code>,{" "}
          <code>connectionId</code> is the connection to bind Alex&apos;s tasks to.
        </p>
        <p>
          <strong>Only Gmail is wired to Mode A&apos;s embedded flow today.</strong> See{" "}
          <a href="/docs/connectors/gmail">the Gmail connector guide</a> for provider-specific setup. Other
          connectors require the dashboard-operated flow (organization-owned, with explicit delegation -- see
          below) or Mode B.
        </p>
      </DocsSection>

      <DocsSection title="Mode B: reuse your existing connection (credential broker)">
        <p>
          For an application that already manages its own provider OAuth client and token storage. Alex never
          sees a second consent screen for an account your application already correctly connected --
          reauthorization is only ever needed for a missing scope, an expired grant, or a revoked one.
        </p>
        <p>
          Register a connection: no token or secret is sent to Authority. <code>brokerConnectionRef</code> is
          whatever identifier your own broker endpoint needs to find the right account.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/customers/$CUSTOMER_ID/connections/broker" \\
  -H "Authorization: Bearer $AUTHORITY_BACKEND_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "connectorId": "gmail",
    "brokerId": "'"$BROKER_ID"'",
    "brokerConnectionRef": "user_482",
    "verifiedAccountRef": "alex@example.com"
  }'`}
        />
        <p>
          At execution time -- every time, never cached -- Authority asks your registered broker endpoint for
          a short-lived access token, uses it once in memory for the one approved connector call, and discards
          it. Your broker refreshes its own stored provider token using your existing OAuth configuration;
          Authority never converts a login token into a provider token, and never holds a long-lived
          credential for a broker-mode connection at all.
        </p>
        <p id="broker-protocol">Your broker endpoint receives:</p>
        <DocsTable
          headers={["Header", "Meaning"]}
          rows={[
            [
              "authority-timestamp",
              "Unix seconds. Reject requests outside a small window (we send one 60 seconds wide).",
            ],
            [
              "authority-nonce",
              "Random per request. Reject a nonce you have already seen -- this is your replay protection.",
            ],
            [
              "authority-signature",
              'HMAC-SHA256, hex, over timestamp + "." + nonce + "." + body, keyed with the shared secret from registration.',
            ],
          ]}
        />
        <p>Request body:</p>
        <CodeBlock
          language="json"
          code={`{
  "connectionId": "...",
  "connectorId": "gmail",
  "brokerConnectionRef": "user_482",
  "timestamp": "1735689600",
  "nonce": "a1b2c3..."
}`}
        />
        <p>Your endpoint must respond within 8 seconds with:</p>
        <CodeBlock language="json" code={`{ "accessToken": "ya29...", "expiresInSeconds": 3600 }`} />
        <p>
          Register a broker from dashboard Settings → your application → Connection brokers. The shared secret
          is shown once; store it next to your broker endpoint&apos;s own configuration.
        </p>
      </DocsSection>

      <DocsSection title="Multiple accounts and explicit task binding">
        <p>
          Alex and Bob can each connect their own Gmail account at the same time -- a connection is unique per
          owner and verified provider account, not per tenant. A task is bound to its connections explicitly,
          at creation, never by first-use guessing once more than one candidate exists:
        </p>
        <CodeBlock
          language="bash"
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/customers/$ALEX_ID/tasks" \\
  -H "Authorization: Bearer $AUTHORITY_BACKEND_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "'"$AGENT_ID"'",
    "intent": "Summarize unread support emails",
    "connections": [{ "connectorId": "gmail", "connectionId": "'"$ALEX_GMAIL_CONNECTION_ID"'" }]
  }'`}
        />
        <p>
          A connection naming Bob&apos;s Gmail for Alex&apos;s task fails the whole call with{" "}
          <code>403 CONNECTION_NOT_USABLE_BY_CUSTOMER</code> -- no task is created half-bound. A task may use
          Alex&apos;s Gmail and Alex&apos;s GitHub together; it can never reach Bob&apos;s connection merely
          because both belong to the same Authority tenant.
        </p>
      </DocsSection>

      <DocsSection title="Delegation">
        <p>
          An organization-owned connection (created the ordinary way, from Integrations) stays
          organization-owned, but can be explicitly shared with specific customers -- a support mailbox every
          customer&apos;s task may read from, for example. Grant and revoke it from dashboard Settings → your
          application → Organization connections &amp; delegation. Revoking takes effect immediately: any task
          still relying on that delegation fails its next execution with an explicit error, never a silent
          fallback to a different account.
        </p>
      </DocsSection>

      <DocsSection title="Backend credential">
        <p id="backend-credential">
          A backend credential (<code>authority_dk_...</code>) authenticates your own server to the endpoints
          on this page -- creating customers, opening connections, starting tasks. It is a separate credential
          space from an agent runtime key and a task session: it cannot authorize or execute a tool call, and
          an agent credential cannot be used here. Issue and revoke it from dashboard Settings → your
          application → Backend credentials; the plaintext is shown exactly once.
        </p>
      </DocsSection>

      <DocsSection title="Frequently asked">
        <DocsTable
          headers={["Question", "Answer"]}
          rows={[
            ["Does my customer need an Authority account?", "No."],
            [
              "Does my customer authorize the same provider twice?",
              "Not when your application already holds a suitable reusable grant and you use Mode B.",
            ],
            [
              "Can an agent choose another customer's connection?",
              "No -- every binding is checked against the task's actual customer on every execution.",
            ],
            [
              "Does connecting Gmail grant every Gmail operation?",
              "No. The provider scope and the task's own contract are separate ceilings; the narrower one always applies.",
            ],
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}
