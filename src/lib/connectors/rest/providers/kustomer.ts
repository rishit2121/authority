import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.kustomer.com/api/core-resources -- API keys are sent as `Authorization: Bearer <key>` to the
 * org-specific `{orgname}.api.kustomerapp.com`.
 */
export const kustomer: RestConnectorSpec = {
  id: "kustomer",
  name: "Kustomer",
  description:
    "Read customers, conversations and their messages, and add an internal note to a conversation.",
  category: "Customer support",
  docsUrl: "https://developer.kustomer.com/api/core-resources",
  host: "{config.org}.api.kustomerapp.com",
  basePath: "/v1",
  credential: {
    label: "API key",
    help: "Settings → Security → API Keys → Add API Key with customer.read, conversation.read, message.read and note.create roles.",
  },
  configFields: [
    {
      key: "org",
      label: "Org name",
      placeholder: "acme (for acme.kustomerapp.com)",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
  ],
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/auth/tokens/current" },
  operations: [
    {
      slug: "get_customer",
      summary: "Returns one customer's profile.",
      method: "GET",
      path: "/customers/{customer_id}",
      sideEffect: "read",
      resourceType: "customer",
      resource: "customer_id",
      dataSensitivity: "confidential",
      args: [{ key: "customer_id", in: "path", required: true, description: "The customer id." }],
    },
    {
      slug: "get_conversation",
      summary: "Returns one conversation's status, assignment and summary.",
      method: "GET",
      path: "/conversations/{conversation_id}",
      sideEffect: "read",
      resourceType: "conversation",
      resource: "conversation_id",
      dataSensitivity: "confidential",
      args: [{ key: "conversation_id", in: "path", required: true, description: "The conversation id." }],
    },
    {
      slug: "list_messages",
      summary: "Lists the messages in one conversation.",
      method: "GET",
      path: "/conversations/{conversation_id}/messages",
      sideEffect: "read",
      resourceType: "conversation",
      resource: "conversation_id",
      dataSensitivity: "confidential",
      args: [{ key: "conversation_id", in: "path", required: true, description: "The conversation id." }],
    },
    {
      slug: "add_note",
      summary: "Adds one internal note to a conversation; customers never see notes.",
      method: "POST",
      path: "/conversations/{conversation_id}/notes",
      sideEffect: "write_create",
      resourceType: "conversation",
      resource: "conversation_id",
      args: [
        { key: "conversation_id", in: "path", required: true, description: "The conversation id." },
        {
          key: "body",
          in: "body",
          required: true,
          freeText: true,
          description: "Note text (up to 10,240 characters).",
        },
      ],
    },
  ],
};
