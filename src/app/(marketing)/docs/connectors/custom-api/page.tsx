import type { Metadata } from "next";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Custom API connector — Authority Docs" };

export default function CustomApiConnectorPage() {
  return (
    <DocsPage
      title="Custom API"
      description="Connect any HTTPS API your tenant controls, then define and publish named operations for it — the only connector where the operations themselves are tenant-authored, not fixed by Authority."
    >
      <DocsSection title="What the agent actually sends">
        <p>
          The upstream URL, HTTP method, headers, and body mapping are all configured by an administrator when
          an operation is published. An agent never constructs or sees any of that — it sends an{" "}
          <strong>operation identifier</strong> (the tool name, e.g. <code>custom_a1b2c3d4.get_order</code>)
          and validated arguments. Authority resolves the rest from the operation&apos;s frozen, published
          definition.
        </p>
      </DocsSection>

      <DocsSection title="Complete example: connection through execution">
        <p>
          1. Connection — an admin adds a base URL (HTTPS only; private/internal destinations are refused):
        </p>
        <CodeBlock
          code={`Name: Widget Orders API
Base URL: https://api.widgets.example`}
        />
        <p>
          No connection-broker support — every credential below is stored server-side (Vault-backed) once,
          through this flow; there is no per-application broker protocol for Custom API.
        </p>
        <p>2. Authentication — a credential (bearer, basic, or API key header), stored in Vault:</p>
        <CodeBlock
          code={`Credential type: Bearer token
Value: •••••••• (never shown again)`}
        />
        <p>3. A developer drafts an operation, then an admin validates and publishes it:</p>
        <CodeBlock
          language="json"
          code={`{
  "slug": "get_order",
  "method": "GET",
  "pathTemplate": "/v1/orders/{orderId}",
  "effect": "read",
  "fields": [{ "key": "orderId", "type": "string", "required": true, "identifiesResource": true }]
}`}
        />
        <p>
          Publishing freezes this definition forever — every contract or capability that names it is pinned to
          exactly this shape, even if the connection&apos;s base URL or credential changes later.
        </p>
        <p>
          4. An admin includes the published tool in a task&apos;s candidate plan and activates the contract:
        </p>
        <CodeBlock
          language="json"
          code={`{ "tool": "custom_a1b2c3d4.get_order", "constraints": [{ "key": "orderId", "equals": "4821" }] }`}
        />
        <p>5. The agent authorizes and executes exactly like any other connector:</p>
        <CodeBlock
          code={`curl -s -X POST "$AUTHORITY_URL/api/v1/authorize" -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY" \\
  -d '{"taskId":"...","tool":"custom_a1b2c3d4.get_order","operation":"get_order","resource":"4821","arguments":{"orderId":"4821"},"idempotencyKey":"demo-1"}'

curl -s -X POST "$AUTHORITY_URL/api/v1/execute" -H "Authorization: Bearer $AUTHORITY_RUNTIME_KEY" \\
  -d '{"capability":"authcap_v1_...","tool":"custom_a1b2c3d4.get_order","operation":"get_order","resource":"4821","arguments":{"orderId":"4821"},"idempotencyKey":"demo-1"}'`}
          language="bash"
        />
        <p>
          Authority builds the real <code>GET https://api.widgets.example/v1/orders/4821</code> request,
          attaches the stored credential, sends it, and returns the response — the agent never saw the base
          URL, method, or credential directly.
        </p>
      </DocsSection>

      <DocsSection title="Input constraints">
        <DocsTable
          headers={["Rule", "Detail"]}
          rows={[
            ["1–20 fields", "Spanning path, query, and body locations."],
            ["Exactly one identifying field", "What a capability binds to; always required if path-located."],
            ["Types", "string, number, or boolean only."],
          ]}
        />
      </DocsSection>

      <DocsSection title="Starting from a template">
        <p>
          The operation-drafting form includes starting points for Notion, HubSpot, Zendesk, Discord,
          Airtable, Intercom, Mailchimp, and Asana — each a real GET-by-id read, or (Discord, Intercom) a
          write whose body is genuinely flat. Picking one fills in the method, path, auth type, and fields;
          you still choose Validate and Publish yourself, and &quot;Preview request&quot; shows the exact
          request before you do.
        </p>
        <p>
          Every template is best-effort, not live-verified against the provider — built from each one&apos;s
          public API reference, the same way filling the form in by hand would be, since this project holds no
          credentials for any of them. Each one names the one thing most likely to need adjusting for your own
          account (a datacenter prefix, a subdomain, an API version). Not every popular API fits: Custom
          API&apos;s body is flat, scalar fields only (see <em>Input constraints</em> below) — a pure-GraphQL
          API, or a REST endpoint whose real payload nests fields inside a wrapper object, can&apos;t be
          represented faithfully, so no template exists for those.
        </p>
      </DocsSection>

      <DocsSection title="Execution guarantees and limitations">
        <p>
          Redirects are refused outright. Private, loopback, and link-local destinations (including cloud
          metadata endpoints) are always blocked, even if DNS later points the base URL there. Authority has
          no visibility into the credential&apos;s actual upstream permissions — only what it tells your API,
          and only the exact request a published operation defines.
        </p>
      </DocsSection>

      <DocsSection title="One credential, many of your customers">
        <p>
          A Custom API connection is one stored credential against one base URL, not a per-end-user login —
          there is no OAuth onboarding here. Every request is sent with the same credential regardless of
          which customer a task runs on behalf of. Delegate the connection to whichever of your customers
          should be able to trigger its published operations (Settings → the connection → Delegations, or the
          developer API&apos;s connection-delegation calls) — the same organization-owned-connection-plus-
          delegation model Stripe, Slack and GitHub repositories all use. Revoking a delegation stops that
          customer&apos;s access immediately; it never touches the underlying credential.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
