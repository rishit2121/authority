import type { RestConnectorSpec } from "../spec";

/** https://dev.frontapp.com/reference/ -- API tokens are sent as `Authorization: Bearer <token>` to api2.frontapp.com. */
export const front: RestConnectorSpec = {
  id: "front",
  name: "Front",
  description: "Read a conversation and its messages, add an internal comment, and send a reply.",
  category: "Customer support",
  docsUrl: "https://dev.frontapp.com/reference/",
  host: "api2.frontapp.com",
  credential: {
    label: "API token",
    help: "Settings → Developers → API tokens → create a token with access to the inboxes the agent should see.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/me" },
  operations: [
    {
      slug: "get_conversation",
      summary: "Returns one conversation's subject, status, assignee and recipient.",
      method: "GET",
      path: "/conversations/{conversation_id}",
      sideEffect: "read",
      resourceType: "conversation",
      resource: "conversation_id",
      dataSensitivity: "confidential",
      args: [
        { key: "conversation_id", in: "path", required: true, description: "The conversation id (cnv_…)." },
      ],
    },
    {
      slug: "list_messages",
      summary: "Lists the messages in one conversation, newest first.",
      method: "GET",
      path: "/conversations/{conversation_id}/messages",
      sideEffect: "read",
      resourceType: "conversation",
      resource: "conversation_id",
      dataSensitivity: "confidential",
      args: [
        { key: "conversation_id", in: "path", required: true, description: "The conversation id (cnv_…)." },
      ],
    },
    {
      slug: "add_comment",
      summary: "Adds one internal comment to a conversation; only teammates see it.",
      method: "POST",
      path: "/conversations/{conversation_id}/comments",
      sideEffect: "write_create",
      resourceType: "conversation",
      resource: "conversation_id",
      args: [
        { key: "conversation_id", in: "path", required: true, description: "The conversation id (cnv_…)." },
        {
          key: "body",
          in: "body",
          required: true,
          freeText: true,
          description: "Comment text (Markdown allowed).",
        },
      ],
    },
    {
      slug: "reply_to_conversation",
      summary: "Sends one reply in a conversation to its recipients.",
      method: "POST",
      path: "/conversations/{conversation_id}/messages",
      sideEffect: "write_create",
      resourceType: "conversation",
      resource: "conversation_id",
      externalCommunication: true,
      args: [
        { key: "conversation_id", in: "path", required: true, description: "The conversation id (cnv_…)." },
        { key: "body", in: "body", required: true, freeText: true, description: "Reply text." },
      ],
    },
  ],
};
