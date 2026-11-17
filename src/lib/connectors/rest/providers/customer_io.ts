import type { RestConnectorSpec } from "../spec";

/** https://docs.customer.io/integrations/api/app/ -- App API keys are sent as `Authorization: Bearer <key>` (US region). */
export const customerIo: RestConnectorSpec = {
  id: "customer_io",
  name: "Customer.io",
  description:
    "List segments and transactional messages, read a person's attributes, and send one transactional email.",
  category: "Marketing & email",
  docsUrl: "https://docs.customer.io/integrations/api/app/",
  host: "api.customer.io",
  basePath: "/v1",
  credential: {
    label: "App API key",
    help: "Customer.io → Settings → Account Settings → API Credentials → App API Keys. US-region workspaces only.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/segments" },
  operations: [
    {
      slug: "list_segments",
      summary: "Lists the workspace's segments.",
      method: "GET",
      path: "/segments",
      sideEffect: "read",
      resourceType: "workspace",
      args: [],
    },
    {
      slug: "list_transactional_messages",
      summary: "Lists the workspace's transactional message templates and their ids.",
      method: "GET",
      path: "/transactional",
      sideEffect: "read",
      resourceType: "workspace",
      args: [],
    },
    {
      slug: "get_customer_attributes",
      summary: "Returns one person's attributes by their customer id.",
      method: "GET",
      path: "/customers/{customer_id}/attributes",
      sideEffect: "read",
      resourceType: "customer",
      resource: "customer_id",
      dataSensitivity: "confidential",
      fixedQuery: { id_type: "id" },
      args: [
        { key: "customer_id", in: "path", required: true, description: "The person's id in Customer.io." },
      ],
    },
    {
      slug: "send_transactional_email",
      summary: "Sends one transactional message template to one person at one address; nothing else.",
      method: "POST",
      path: "/send/email",
      sideEffect: "write_create",
      resourceType: "email_recipient",
      resource: "to",
      externalCommunication: true,
      args: [
        {
          key: "transactional_message_id",
          in: "body",
          required: true,
          description: "The transactional message id (or trigger name) to send.",
        },
        { key: "to", in: "body", required: true, description: "Recipient email address." },
        {
          key: "identifier_email",
          in: "body",
          target: "identifiers.email",
          required: true,
          description: "The person the message is attributed to, by email (usually the same address).",
        },
      ],
    },
  ],
};
