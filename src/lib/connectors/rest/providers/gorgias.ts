import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.gorgias.com/reference/authentication -- private-app API keys use basic auth with the user's
 * email as the username and the API key as the password, against the account's own `{domain}.gorgias.com`.
 */
export const gorgias: RestConnectorSpec = {
  id: "gorgias",
  name: "Gorgias",
  description: "Read tickets, look up customers by email, and add an internal note to a ticket.",
  category: "Customer support",
  docsUrl: "https://developers.gorgias.com/reference/get-ticket",
  host: "{config.domain}.gorgias.com",
  basePath: "/api",
  credential: {
    label: "API key",
    help: "Settings → REST API → copy the API key. Use it with the email of the user it belongs to below.",
  },
  configFields: [
    {
      key: "domain",
      label: "Gorgias domain",
      placeholder: "acme (for acme.gorgias.com)",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
    {
      key: "email",
      label: "User email",
      placeholder: "you@company.com",
      help: "The Gorgias user the API key belongs to.",
      pattern: "^[^\\s@/:]+@[^\\s@/:]+\\.[^\\s@/:]+$",
    },
  ],
  auth: { basic: { username: "{config.email}", password: "{key}" } },
  verify: { method: "GET", path: "/account" },
  operations: [
    {
      slug: "get_ticket",
      summary: "Returns one ticket with its customer, status and messages.",
      method: "GET",
      path: "/tickets/{ticket_id}",
      sideEffect: "read",
      resourceType: "ticket",
      resource: "ticket_id",
      dataSensitivity: "confidential",
      args: [{ key: "ticket_id", in: "path", type: "number", required: true, description: "The ticket id." }],
    },
    {
      slug: "find_customer_by_email",
      summary: "Lists customers whose primary email matches.",
      method: "GET",
      path: "/customers",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [{ key: "email", in: "query", required: true, description: "The customer's primary email." }],
    },
    {
      slug: "get_customer",
      summary: "Returns one customer's details.",
      method: "GET",
      path: "/customers/{customer_id}",
      sideEffect: "read",
      resourceType: "customer",
      resource: "customer_id",
      dataSensitivity: "confidential",
      args: [
        { key: "customer_id", in: "path", type: "number", required: true, description: "The customer id." },
      ],
    },
    {
      slug: "add_internal_note",
      summary: "Adds one internal note to a ticket; the customer does not see it.",
      method: "POST",
      path: "/tickets/{ticket_id}/messages",
      sideEffect: "write_create",
      resourceType: "ticket",
      resource: "ticket_id",
      fixedBody: { channel: "internal-note", from_agent: true, via: "api" },
      args: [
        { key: "ticket_id", in: "path", type: "number", required: true, description: "The ticket id." },
        {
          key: "sender_email",
          in: "body",
          target: "sender.email",
          required: true,
          description: "Email of the Gorgias user writing the note.",
        },
        { key: "body_text", in: "body", required: true, freeText: true, description: "Note text." },
      ],
    },
  ],
};
