import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.zendesk.com/api-reference/ -- API tokens use basic auth with `{email}/token` as the username and
 * the token as the password, against the account's own `{subdomain}.zendesk.com`.
 */
export const zendesk: RestConnectorSpec = {
  id: "zendesk",
  name: "Zendesk",
  description: "List and read tickets, open a ticket, and add a comment to one.",
  category: "Customer support",
  docsUrl: "https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/",
  iconSlug: "zendesk",
  host: "{config.subdomain}.zendesk.com",
  basePath: "/api/v2",
  credential: {
    label: "API token",
    help: "Admin Center → Apps and integrations → Zendesk API → add an API token. Use it with the agent email below.",
  },
  configFields: [
    {
      key: "subdomain",
      label: "Zendesk subdomain",
      placeholder: "acme (for acme.zendesk.com)",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
    {
      key: "email",
      label: "Agent email",
      placeholder: "you@company.com",
      help: "The Zendesk user the token acts as.",
      pattern: "^[^\\s@/:]+@[^\\s@/:]+\\.[^\\s@/:]+$",
    },
  ],
  auth: { basic: { username: "{config.email}/token", password: "{key}" } },
  verify: { method: "GET", path: "/users/me.json" },
  operations: [
    {
      slug: "list_tickets",
      summary: "Lists recent tickets in the account.",
      method: "GET",
      path: "/tickets.json",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [],
    },
    {
      slug: "get_ticket",
      summary: "Returns one ticket's subject, status, requester and description.",
      method: "GET",
      path: "/tickets/{ticket_id}.json",
      sideEffect: "read",
      resourceType: "ticket",
      resource: "ticket_id",
      dataSensitivity: "confidential",
      args: [{ key: "ticket_id", in: "path", type: "number", required: true, description: "The ticket id." }],
    },
    {
      slug: "create_ticket",
      summary: "Opens one new ticket with a subject and first comment.",
      method: "POST",
      path: "/tickets.json",
      sideEffect: "write_create",
      resourceType: "account",
      args: [
        {
          key: "subject",
          in: "body",
          target: "ticket.subject",
          required: true,
          freeText: true,
          description: "Ticket subject.",
        },
        {
          key: "body",
          in: "body",
          target: "ticket.comment.body",
          required: true,
          freeText: true,
          description: "First comment.",
        },
      ],
    },
    {
      slug: "add_comment",
      summary: "Adds one comment to a ticket; a public comment is emailed to the requester.",
      method: "PUT",
      path: "/tickets/{ticket_id}.json",
      sideEffect: "write_update",
      resourceType: "ticket",
      resource: "ticket_id",
      externalCommunication: true,
      args: [
        { key: "ticket_id", in: "path", type: "number", required: true, description: "The ticket id." },
        {
          key: "body",
          in: "body",
          target: "ticket.comment.body",
          required: true,
          freeText: true,
          description: "Comment text.",
        },
        {
          key: "public",
          in: "body",
          target: "ticket.comment.public",
          type: "boolean",
          required: true,
          description: "Whether the requester sees it.",
        },
      ],
    },
  ],
};
