import type { RestConnectorSpec } from "../spec";

/**
 * https://recurly.com/developers/api/v2021-02-25/ -- HTTP basic auth with the private API key as the username and an
 * empty password; the version is pinned with `Accept: application/vnd.recurly.v2021-02-25+json`.
 */
export const recurly: RestConnectorSpec = {
  id: "recurly",
  name: "Recurly",
  description: "List and read accounts, their subscriptions and invoices, and add a note to an account.",
  category: "Finance & accounting",
  docsUrl: "https://recurly.com/developers/api/v2021-02-25/",
  host: "v3.recurly.com",
  credential: {
    label: "Private API key",
    help: "Recurly → Integrations → API Credentials → private API key. US-hosted sites only (EU sites use v3.eu.recurly.com).",
  },
  auth: { basic: { username: "{key}", password: "" } },
  headers: { Accept: "application/vnd.recurly.v2021-02-25+json" },
  verify: { method: "GET", path: "/sites" },
  operations: [
    {
      slug: "list_accounts",
      summary: "Lists the site's customer accounts.",
      method: "GET",
      path: "/accounts",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        { key: "limit", in: "query", type: "number", required: false, description: "Page size (1-200)." },
        { key: "email", in: "query", required: false, description: "Only accounts with this exact email." },
      ],
    },
    {
      slug: "get_account",
      summary: "Returns one customer account.",
      method: "GET",
      path: "/accounts/{account_id}",
      sideEffect: "read",
      resourceType: "customer_account",
      resource: "account_id",
      dataSensitivity: "confidential",
      args: [
        { key: "account_id", in: "path", required: true, description: "Account id, or code-<account code>." },
      ],
    },
    {
      slug: "list_account_subscriptions",
      summary: "Lists one account's subscriptions.",
      method: "GET",
      path: "/accounts/{account_id}/subscriptions",
      sideEffect: "read",
      resourceType: "customer_account",
      resource: "account_id",
      dataSensitivity: "confidential",
      args: [
        { key: "account_id", in: "path", required: true, description: "Account id, or code-<account code>." },
      ],
    },
    {
      slug: "get_invoice",
      summary: "Returns one invoice's line items, totals and state.",
      method: "GET",
      path: "/invoices/{invoice_id}",
      sideEffect: "read",
      resourceType: "invoice",
      resource: "invoice_id",
      dataSensitivity: "confidential",
      args: [
        {
          key: "invoice_id",
          in: "path",
          required: true,
          description: "Invoice id, or number-<invoice number>.",
        },
      ],
    },
    {
      slug: "add_account_note",
      summary: "Adds one internal note to an account; changes nothing else.",
      method: "POST",
      path: "/accounts/{account_id}/notes",
      sideEffect: "write_create",
      resourceType: "customer_account",
      resource: "account_id",
      args: [
        { key: "account_id", in: "path", required: true, description: "Account id, or code-<account code>." },
        { key: "message", in: "body", required: true, freeText: true, description: "The note text." },
      ],
    },
  ],
};
