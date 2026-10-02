import type { Metadata } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Authentication — Authority Docs" };

export default function AuthenticationPage() {
  return (
    <DocsPage
      title="Authentication"
      description="Two credentials matter to an agent integration: the runtime key you issue once, and the capability token Authority mints per authorized call. Everything else below exists for completeness, not because your agent needs it."
    >
      <DocsSection title="Credential types">
        <DocsTable
          headers={["Credential", "What it's for", "Who holds it"]}
          rows={[
            [
              "Browser session",
              "Signs a person into the dashboard (cookie-based).",
              "A human, in a browser.",
            ],
            [
              <>
                Agent runtime key (<code>authority_rk_…</code>)
              </>,
              "Authenticates your agent process to Authority's API.",
              "Your agent's environment, as a secret.",
            ],
            [
              <>
                Task-session token (<code>authority_ts_…</code>)
              </>,
              <>
                Optional, short-lived stand-in for the runtime key, scoped to one task — see{" "}
                <Link href="/docs/task-sessions">Task sessions</Link>.
              </>,
              "Your agent's environment, briefly, once per task.",
            ],
            [
              <>
                Capability token (<code>authcap_v1_…</code>)
              </>,
              "Authorizes one narrowly bound execution — a specific tool, operation, and resource, for a short time.",
              "Minted per call by Authority; your agent holds it only briefly.",
            ],
            [
              "Connector credential",
              "Authenticates Authority to the external service (a Stripe key, a GitHub App installation token, a Gmail OAuth refresh token, …).",
              "Stays server-side in Authority's Vault. An agent never sees it.",
            ],
            [
              "OpenAI / OpenRouter key",
              "Platform configuration for Authority's own AI features (risk evaluation, plan assistance). Not an agent runtime credential and not something your agent authenticates with.",
              "Authority's own server configuration.",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection title="The runtime key">
        <p>
          Issued from an agent&apos;s detail page in the dashboard (
          <code>/app/agents/&#123;agentId&#125;</code>) by an admin or developer. It is shown exactly once, at
          creation — copy it immediately; Authority does not store the plaintext and cannot show it to you
          again. If you lose it, revoke it from the same page and issue a new one.
        </p>
        <p>
          Format: <code>authority_rk_</code> followed by 64 hex characters. Send it as a bearer token:
        </p>
        <CodeBlock code={`Authorization: Bearer authority_rk_<...>`} />
        <p>
          Store it the same way you&apos;d store any server secret — an environment variable your agent
          process reads at startup, never committed to source control, never logged. It is never accepted
          anywhere except the <code>Authorization</code> header.
        </p>
        <p>
          <code>POST /api/v1/sessions</code> (creating a <Link href="/docs/task-sessions">task session</Link>)
          always requires the runtime key directly — a session can&apos;t be used to create another session.
          Every other protected endpoint accepts either the runtime key or a task session token in its place:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <code>GET /api/v1/tasks/&#123;taskId&#125;/tools</code>
          </li>
          <li>
            <code>POST /api/v1/authorize</code>
          </li>
          <li>
            <code>POST /api/v1/execute</code>
          </li>
          <li>
            <code>POST /api/v1/github/execute</code>
          </li>
          <li>
            <code>GET /api/v1/approvals/&#123;id&#125;</code>
          </li>
          <li>
            <code>POST /api/v1/capabilities/consume</code> and <code>POST /api/v1/capabilities/revoke</code>
          </li>
          <li>
            The MCP bridge, <code>/api/mcp/tasks/&#123;taskId&#125;</code> (see{" "}
            <Link href="/docs/tool-filtering">Tool filtering</Link>)
          </li>
        </ul>
        <p>
          A missing, malformed, or revoked key all return the same <code>401 UNAUTHENTICATED</code> —
          deliberately indistinguishable, so a key&apos;s validity can&apos;t be probed. 20 failed attempts
          for the same key prefix within 60 seconds triggers <code>429 RATE_LIMITED</code>.
        </p>
        <p>
          No endpoint accepts a browser session cookie. Using a task session instead of the runtime key
          directly is entirely optional — see <Link href="/docs/task-sessions">Task sessions</Link> for how to
          create one and what it does and doesn&apos;t change.
        </p>
      </DocsSection>

      <DocsSection title="The capability token">
        <p>
          Minted by a successful <code>POST /api/v1/authorize</code> call, in the response&apos;s{" "}
          <code>capability.token</code> field. Format: <code>authcap_v1_</code> followed by 43 base64url
          characters — opaque, not a JWT, not something you decode.
        </p>
        <p>
          It is returned <strong>only on first issuance</strong>. If you replay the same{" "}
          <code>idempotencyKey</code>, the response repeats the same decision but{" "}
          <code>capability.token</code> is <code>null</code> and <code>capability.tokenAlreadyIssued</code> is{" "}
          <code>true</code> — Authority never reissues a token for a request it already answered. If you lose
          a token before using it, revoke the capability (<code>POST /api/v1/capabilities/revoke</code>) and
          authorize again with a new idempotency key.
        </p>
        <p>
          Expiration defaults to 60 seconds from issuance and can never exceed 15 minutes, regardless of
          configuration. Pass it in the execute request body as the <code>capability</code> field — not a
          header:
        </p>
        <CodeBlock code={`{ "capability": "authcap_v1_...", "tool": "...", ... }`} />
        <p>
          A capability can authorize more than one use (<code>maxUses</code>, 1–5, default 1) when your task
          genuinely needs to call the same exact tool/operation/resource more than once. Each consumption is
          tracked; once uses are exhausted, further attempts fail with <code>CAPABILITY_ALREADY_USED</code>.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
