import type { RestConnectorSpec } from "../spec";

/**
 * https://docs.usepylon.com/pylon-docs/developer/api/authentication -- API tokens are sent as
 * `Authorization: Bearer <token>` to api.usepylon.com (US region).
 */
export const pylon: RestConnectorSpec = {
  id: "pylon",
  name: "Pylon",
  description:
    "Search and read support issues and their messages, reply to an issue, and add an internal note.",
  category: "Customer support",
  docsUrl: "https://docs.usepylon.com/pylon-docs/developer/api/api-reference/issues",
  host: "api.usepylon.com",
  credential: {
    label: "API token",
    help: "Settings → Integrations & dev → API → Tokens → Create API Token (admins only). US-region tokens only.",
    placeholder: "pylon_api_…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/me" },
  operations: [
    {
      slug: "search_issues",
      summary: "Searches issues by text.",
      method: "POST",
      path: "/issues/search",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        { key: "search_text", in: "body", required: true, description: "Text to search issues for." },
        { key: "limit", in: "body", type: "number", required: false, description: "Maximum results." },
      ],
    },
    {
      slug: "get_issue",
      summary: "Returns one issue's title, state, account and requester.",
      method: "GET",
      path: "/issues/{issue_id}",
      sideEffect: "read",
      resourceType: "issue",
      resource: "issue_id",
      dataSensitivity: "confidential",
      args: [{ key: "issue_id", in: "path", required: true, description: "The issue id." }],
    },
    {
      slug: "get_messages",
      summary: "Returns one issue's messages, including replies and internal notes, oldest first.",
      method: "GET",
      path: "/issues/{issue_id}/messages",
      sideEffect: "read",
      resourceType: "issue",
      resource: "issue_id",
      dataSensitivity: "confidential",
      args: [{ key: "issue_id", in: "path", required: true, description: "The issue id." }],
    },
    {
      slug: "reply_to_issue",
      summary: "Sends one customer-facing reply on an issue, continuing an existing message thread.",
      method: "POST",
      path: "/issues/{issue_id}/reply",
      sideEffect: "write_create",
      resourceType: "issue",
      resource: "issue_id",
      externalCommunication: true,
      args: [
        { key: "issue_id", in: "path", required: true, description: "The issue id." },
        {
          key: "message_id",
          in: "body",
          required: true,
          description: "Top-level id of the message to reply to (from get_messages).",
        },
        {
          key: "body_html",
          in: "body",
          required: true,
          freeText: true,
          description: "Reply content (HTML).",
        },
      ],
    },
    {
      slug: "add_note",
      summary: "Adds one internal note to an issue; the customer does not see it.",
      method: "POST",
      path: "/issues/{issue_id}/note",
      sideEffect: "write_create",
      resourceType: "issue",
      resource: "issue_id",
      args: [
        { key: "issue_id", in: "path", required: true, description: "The issue id." },
        { key: "body_html", in: "body", required: true, freeText: true, description: "Note content (HTML)." },
      ],
    },
  ],
};
