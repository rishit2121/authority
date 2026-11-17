import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.freshworks.com/crm/api/ -- the API key is sent as `Authorization: Token token=<key>` to the
 * account's own bundle `{domain}.myfreshworks.com/crm/sales`.
 */
export const freshsales: RestConnectorSpec = {
  id: "freshsales",
  name: "Freshsales",
  description: "Search and read contacts, read a deal, create a contact, and add a note to a record.",
  category: "CRM & sales",
  docsUrl: "https://developers.freshworks.com/crm/api/",
  host: "{config.domain}.myfreshworks.com",
  basePath: "/crm/sales/api",
  credential: {
    label: "API key",
    help: "Profile picture → Profile Settings → API Settings → copy your API key.",
  },
  configFields: [
    {
      key: "domain",
      label: "Bundle alias",
      placeholder: "acme (for acme.myfreshworks.com/crm/sales)",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
  ],
  auth: { headers: { Authorization: "Token token={key}" } },
  verify: { method: "GET", path: "/selector/owners" },
  operations: [
    {
      slug: "search_contacts",
      summary: "Searches contacts by name or email.",
      method: "GET",
      path: "/search",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      fixedQuery: { include: "contact" },
      args: [{ key: "q", in: "query", required: true, description: "Name or email to search for." }],
    },
    {
      slug: "get_contact",
      summary: "Returns one contact's details.",
      method: "GET",
      path: "/contacts/{contact_id}",
      sideEffect: "read",
      resourceType: "contact",
      resource: "contact_id",
      dataSensitivity: "confidential",
      args: [
        { key: "contact_id", in: "path", type: "number", required: true, description: "The contact id." },
      ],
    },
    {
      slug: "get_deal",
      summary: "Returns one deal's details.",
      method: "GET",
      path: "/deals/{deal_id}",
      sideEffect: "read",
      resourceType: "deal",
      resource: "deal_id",
      args: [{ key: "deal_id", in: "path", type: "number", required: true, description: "The deal id." }],
    },
    {
      slug: "create_contact",
      summary: "Creates one contact with an email and optional name.",
      method: "POST",
      path: "/contacts",
      sideEffect: "write_create",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "first_name",
          in: "body",
          target: "contact.first_name",
          required: false,
          description: "First name.",
        },
        {
          key: "last_name",
          in: "body",
          target: "contact.last_name",
          required: false,
          description: "Last name.",
        },
        {
          key: "email",
          in: "body",
          target: "contact.email",
          required: true,
          description: "Primary email (Freshsales needs an email, mobile or Twitter id).",
        },
      ],
    },
    {
      slug: "add_note",
      summary: "Adds one note to a contact, account or deal.",
      method: "POST",
      path: "/notes",
      sideEffect: "write_create",
      resourceType: "record",
      resource: "targetable_id",
      args: [
        {
          key: "targetable_type",
          in: "body",
          target: "note.targetable_type",
          required: true,
          description: '"Contact", "SalesAccount" or "Deal".',
        },
        {
          key: "targetable_id",
          in: "body",
          target: "note.targetable_id",
          type: "number",
          required: true,
          description: "Id of the record.",
        },
        {
          key: "description",
          in: "body",
          target: "note.description",
          required: true,
          freeText: true,
          description: "Note text.",
        },
      ],
    },
  ],
};
