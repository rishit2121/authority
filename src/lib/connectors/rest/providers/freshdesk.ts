import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.freshdesk.com/api/ -- basic auth with the API key as the username and `X` as the password,
 * against the helpdesk's own `{domain}.freshdesk.com`.
 */
export const freshdesk: RestConnectorSpec = {
  id: "freshdesk",
  name: "Freshdesk",
  description: "Read tickets, look up a contact by email, reply to a ticket, and add a private note.",
  category: "Customer support",
  docsUrl: "https://developers.freshdesk.com/api/",
  host: "{config.domain}.freshdesk.com",
  basePath: "/api/v2",
  credential: {
    label: "API key",
    help: "In Freshdesk: your profile picture → Profile settings → View API key.",
  },
  configFields: [
    {
      key: "domain",
      label: "Freshdesk subdomain",
      placeholder: "acme (for acme.freshdesk.com)",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
  ],
  auth: { basic: { username: "{key}", password: "X" } },
  verify: { method: "GET", path: "/agents/me" },
  operations: [
    {
      slug: "get_ticket",
      summary: "Returns one ticket's subject, status, requester and description.",
      method: "GET",
      path: "/tickets/{ticket_id}",
      sideEffect: "read",
      resourceType: "ticket",
      resource: "ticket_id",
      dataSensitivity: "confidential",
      args: [{ key: "ticket_id", in: "path", type: "number", required: true, description: "The ticket id." }],
    },
    {
      slug: "find_contact_by_email",
      summary: "Lists the contact with this email address (at most one).",
      method: "GET",
      path: "/contacts",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [{ key: "email", in: "query", required: true, description: "The contact's email address." }],
    },
    {
      slug: "reply_to_ticket",
      summary: "Adds one public reply to a ticket; it is emailed to the requester.",
      method: "POST",
      path: "/tickets/{ticket_id}/reply",
      sideEffect: "write_create",
      resourceType: "ticket",
      resource: "ticket_id",
      externalCommunication: true,
      args: [
        { key: "ticket_id", in: "path", type: "number", required: true, description: "The ticket id." },
        { key: "body", in: "body", required: true, freeText: true, description: "Reply content (HTML)." },
      ],
    },
    {
      slug: "add_private_note",
      summary: "Adds one private note to a ticket; only agents see it.",
      method: "POST",
      path: "/tickets/{ticket_id}/notes",
      sideEffect: "write_create",
      resourceType: "ticket",
      resource: "ticket_id",
      fixedBody: { private: true },
      args: [
        { key: "ticket_id", in: "path", type: "number", required: true, description: "The ticket id." },
        { key: "body", in: "body", required: true, freeText: true, description: "Note content (HTML)." },
      ],
    },
  ],
};
