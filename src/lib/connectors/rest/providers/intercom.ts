import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.intercom.com/docs/references/rest-api/api.intercom.io/ -- the workspace access token is sent as
 * `Authorization: Bearer <token>` to api.intercom.io (US-hosted workspaces).
 */
export const intercom: RestConnectorSpec = {
  id: "intercom",
  name: "Intercom",
  description: "Read conversations and contacts, reply to a conversation, and add an internal note.",
  category: "Customer support",
  docsUrl:
    "https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/replyconversation",
  iconSlug: "intercom",
  host: "api.intercom.io",
  credential: {
    label: "Access token",
    help: "Developer Hub → your app → Configure → Authentication → copy the access token. US-hosted workspaces only.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  headers: { "Intercom-Version": "2.11" },
  verify: { method: "GET", path: "/me" },
  operations: [
    {
      slug: "get_conversation",
      summary: "Returns one conversation with its parts (messages and notes).",
      method: "GET",
      path: "/conversations/{conversation_id}",
      sideEffect: "read",
      resourceType: "conversation",
      resource: "conversation_id",
      dataSensitivity: "confidential",
      args: [{ key: "conversation_id", in: "path", required: true, description: "The conversation id." }],
    },
    {
      slug: "get_contact",
      summary: "Returns one contact (user or lead).",
      method: "GET",
      path: "/contacts/{contact_id}",
      sideEffect: "read",
      resourceType: "contact",
      resource: "contact_id",
      dataSensitivity: "confidential",
      args: [{ key: "contact_id", in: "path", required: true, description: "The contact id." }],
    },
    {
      slug: "reply_to_conversation",
      summary: "Sends one admin reply in a conversation; the customer sees it.",
      method: "POST",
      path: "/conversations/{conversation_id}/reply",
      sideEffect: "write_create",
      resourceType: "conversation",
      resource: "conversation_id",
      externalCommunication: true,
      fixedBody: { message_type: "comment", type: "admin" },
      args: [
        { key: "conversation_id", in: "path", required: true, description: "The conversation id." },
        { key: "admin_id", in: "body", required: true, description: "Id of the admin the reply is sent as." },
        {
          key: "body",
          in: "body",
          required: true,
          freeText: true,
          description: "Reply text (HTML allowed).",
        },
      ],
    },
    {
      slug: "add_note",
      summary: "Adds one internal note to a conversation; the customer does not see it.",
      method: "POST",
      path: "/conversations/{conversation_id}/reply",
      sideEffect: "write_create",
      resourceType: "conversation",
      resource: "conversation_id",
      fixedBody: { message_type: "note", type: "admin" },
      args: [
        { key: "conversation_id", in: "path", required: true, description: "The conversation id." },
        { key: "admin_id", in: "body", required: true, description: "Id of the admin writing the note." },
        { key: "body", in: "body", required: true, freeText: true, description: "Note text (HTML allowed)." },
      ],
    },
  ],
};
