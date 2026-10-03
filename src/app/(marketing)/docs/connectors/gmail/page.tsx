import type { Metadata } from "next";

import { DocsPage, DocsSection, DocsTable } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Gmail connector — Authority Docs" };

export default function GmailConnectorPage() {
  return (
    <DocsPage title="Gmail" description="Read, search, and send mail from the connected Google account.">
      <DocsSection title="Connection setup">
        <p>
          An admin connects at <code>/app/integrations/gmail</code> via Google&apos;s own OAuth consent screen
          — Authority never sees a password, only a long-lived refresh token (stored in Vault). Google
          requires a server-side <code>GOOGLE_OAUTH_CLIENT_ID</code>/<code>GOOGLE_OAUTH_CLIENT_SECRET</code>{" "}
          to be configured for this deployment first.
        </p>
      </DocsSection>

      <DocsSection title="OAuth scope">
        <p>
          The requested scope is <code>https://mail.google.com/</code> (full mailbox access) — intentionally
          broad so a reconnect is never needed again as more operations are added. The scope authorizes
          nothing by itself; only the operations below are ever actually callable.
        </p>
      </DocsSection>

      <DocsSection title="Supported operations">
        <DocsTable
          headers={["Operation", "Arguments", "Effect", "Approval"]}
          rows={[
            ["gmail.list_messages", "query?, max_results?", "read", "—"],
            ["gmail.get_message", "message_id", "read", "—"],
            ["gmail.list_labels", "—", "read", "—"],
            ["gmail.send_email", "to, subject, body?", "write", "Always requires approval"],
          ]}
        />
      </DocsSection>

      <DocsSection title="Granted by the scope, never used by Authority">
        <p>
          Permanently deleting messages/threads, modifying messages (archive, trash, mark read, relabel),
          managing drafts, creating/renaming/deleting labels, and changing mailbox settings (filters,
          forwarding, vacation responder, send-as aliases) are all within the OAuth grant but have no
          request-building path in the connector&apos;s code.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
