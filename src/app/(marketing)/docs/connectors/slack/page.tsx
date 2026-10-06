import type { Metadata } from "next";

import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Slack connector — Authority Docs" };

export default function SlackConnectorPage() {
  return (
    <DocsPage title="Slack" description="A fixed, audited set of operations against Slack's own Web API.">
      <DocsSection title="Connection setup">
        <p>
          An admin connects at <code>/app/integrations/slack</code> with a bot token (<code>xoxb-…</code>)
          created in your own Slack app&apos;s OAuth settings, scoped to <code>chat:write</code> and{" "}
          <code>channels:read</code>.
        </p>
        <p>
          No connection-broker support — the bot token is stored server-side (Vault-backed) once, through this
          dashboard flow; there is no per-application broker protocol for Slack.
        </p>
      </DocsSection>

      <DocsSection title="Supported operations">
        <DocsTable
          headers={["Operation", "Arguments", "Effect"]}
          rows={[
            ["slack.post_message", "channel, text", "write"],
            ["slack.list_channels", "—", "read"],
          ]}
        />
      </DocsSection>

      <DocsSection title="Granted by the token, never used by Authority">
        <p>
          Authority only ever calls <code>chat.postMessage</code> and <code>conversations.list</code>. If your
          bot token has broader scopes (reading message history, DMs, managing files or channels), Authority
          never uses them, no matter what a task asks for.
        </p>
      </DocsSection>

      <DocsSection title="Every message is sent by the bot — never on behalf of a specific person">
        <p>
          A Slack connection is one bot identity in one workspace, not a per-end-user credential — there is no
          OAuth onboarding where an individual Slack user signs in and grants their own access, and Authority
          never impersonates a human or posts &quot;as&quot; your customer. Every{" "}
          <code>slack.post_message</code> call appears in Slack exactly the same way regardless of which of
          your customers the task runs on behalf of: sent by the bot, under the bot&apos;s own name and
          avatar.
        </p>
        <p>
          Delegate this one connection to as many of your own customers as should be able to trigger it
          (Settings → the connection → Delegations, or the developer API&apos;s connection-delegation calls) —
          the same organization-owned-connection-plus-delegation model Stripe, GitHub repositories and
          database connections all use. Delegation controls{" "}
          <strong>which of your customers can cause a message to be sent</strong>, not{" "}
          <strong>who Slack shows as the sender</strong> — that is always the bot, in every case. Revoking a
          delegation stops that customer&apos;s access immediately; it never touches the bot token itself.
        </p>
      </DocsSection>

      <DocsSection title="Resource binding">
        <p>
          A capability authorized to post in one <code>channel</code> cannot be replayed against another.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
