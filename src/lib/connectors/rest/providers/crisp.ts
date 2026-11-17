import type { RestConnectorSpec } from "../spec";

/**
 * https://docs.crisp.chat/guides/rest-api/authentication/website-token/ -- website tokens use basic auth with the
 * token identifier as the username and the token key as the password, plus `X-Crisp-Tier: website`, against
 * api.crisp.chat.
 */
export const crisp: RestConnectorSpec = {
  id: "crisp",
  name: "Crisp",
  description: "List and read conversations and their messages, reply to a visitor, and add a private note.",
  category: "Customer support",
  docsUrl: "https://docs.crisp.chat/references/rest-api/v1/",
  host: "api.crisp.chat",
  basePath: "/v1/website/{config.website_id}",
  credential: {
    label: "Website token key",
    help: "Settings → Workspace Settings → Advanced configuration → API Token → Generate Token. Paste the key here.",
  },
  configFields: [
    {
      key: "token_id",
      label: "Website token identifier",
      help: "The identifier shown with the token key.",
      pattern: "^[A-Za-z0-9-]{8,64}$",
    },
    {
      key: "website_id",
      label: "Website id",
      help: "Settings → Workspace Settings → Setup Instructions.",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    },
  ],
  auth: { basic: { username: "{config.token_id}", password: "{key}" } },
  headers: { "X-Crisp-Tier": "website" },
  verify: { method: "GET", path: "/conversations/1" },
  operations: [
    {
      slug: "list_conversations",
      summary: "Lists one page of the workspace's conversations, most recent first.",
      method: "GET",
      path: "/conversations/{page_number}",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "page_number",
          in: "path",
          type: "number",
          required: true,
          description: "Page number, starting at 1.",
        },
      ],
    },
    {
      slug: "get_conversation",
      summary: "Returns one conversation's state, visitor and metadata.",
      method: "GET",
      path: "/conversation/{session_id}",
      sideEffect: "read",
      resourceType: "conversation",
      resource: "session_id",
      dataSensitivity: "confidential",
      args: [
        {
          key: "session_id",
          in: "path",
          required: true,
          description: "The conversation session id (session_…).",
        },
      ],
    },
    {
      slug: "get_messages",
      summary: "Returns the messages in one conversation.",
      method: "GET",
      path: "/conversation/{session_id}/messages",
      sideEffect: "read",
      resourceType: "conversation",
      resource: "session_id",
      dataSensitivity: "confidential",
      args: [
        {
          key: "session_id",
          in: "path",
          required: true,
          description: "The conversation session id (session_…).",
        },
      ],
    },
    {
      slug: "send_reply",
      summary: "Sends one text message from an operator to the visitor in a conversation.",
      method: "POST",
      path: "/conversation/{session_id}/message",
      sideEffect: "write_create",
      resourceType: "conversation",
      resource: "session_id",
      externalCommunication: true,
      fixedBody: { type: "text", from: "operator", origin: "chat" },
      args: [
        {
          key: "session_id",
          in: "path",
          required: true,
          description: "The conversation session id (session_…).",
        },
        { key: "content", in: "body", required: true, freeText: true, description: "Message text." },
      ],
    },
    {
      slug: "add_note",
      summary: "Adds one private note to a conversation; the visitor does not see it.",
      method: "POST",
      path: "/conversation/{session_id}/message",
      sideEffect: "write_create",
      resourceType: "conversation",
      resource: "session_id",
      fixedBody: { type: "note", from: "operator", origin: "chat" },
      args: [
        {
          key: "session_id",
          in: "path",
          required: true,
          description: "The conversation session id (session_…).",
        },
        { key: "content", in: "body", required: true, freeText: true, description: "Note text." },
      ],
    },
  ],
};
