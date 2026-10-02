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

      <DocsSection title="Resource binding">
        <p>
          A capability authorized to post in one <code>channel</code> cannot be replayed against another.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
