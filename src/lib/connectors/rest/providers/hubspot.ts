import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/guide -- private app access tokens are sent as
 * `Authorization: Bearer <token>` to api.hubapi.com.
 */
export const hubspot: RestConnectorSpec = {
  id: "hubspot",
  name: "HubSpot",
  description: "Search and read contacts, read a deal, and create a contact.",
  category: "CRM & sales",
  docsUrl: "https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/guide",
  iconSlug: "hubspot",
  host: "api.hubapi.com",
  credential: {
    label: "Private app access token",
    help: "Settings → Integrations → Private Apps → create an app with crm.objects.contacts.read/write and crm.objects.deals.read, then copy its access token.",
    placeholder: "pat-na1-…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/crm/v3/objects/contacts?limit=1" },
  operations: [
    {
      slug: "search_contacts",
      summary: "Searches contacts' default text properties (name, email, phone, company) for a term.",
      method: "POST",
      path: "/crm/v3/objects/contacts/search",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "query",
          in: "body",
          required: true,
          description: "Text to search for, e.g. a name or email.",
        },
        {
          key: "limit",
          in: "body",
          type: "number",
          required: false,
          description: "Results per page (max 200).",
        },
      ],
    },
    {
      slug: "get_contact",
      summary: "Returns one contact's default properties.",
      method: "GET",
      path: "/crm/v3/objects/contacts/{contact_id}",
      sideEffect: "read",
      resourceType: "contact",
      resource: "contact_id",
      dataSensitivity: "confidential",
      args: [{ key: "contact_id", in: "path", required: true, description: "The contact's record id." }],
    },
    {
      slug: "get_deal",
      summary: "Returns one deal's default properties (name, stage, amount, close date).",
      method: "GET",
      path: "/crm/v3/objects/deals/{deal_id}",
      sideEffect: "read",
      resourceType: "deal",
      resource: "deal_id",
      args: [{ key: "deal_id", in: "path", required: true, description: "The deal's record id." }],
    },
    {
      slug: "create_contact",
      summary: "Creates one contact with an email and optional first and last name.",
      method: "POST",
      path: "/crm/v3/objects/contacts",
      sideEffect: "write_create",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "email",
          in: "body",
          target: "properties.email",
          required: true,
          description: "Contact's email.",
        },
        {
          key: "firstname",
          in: "body",
          target: "properties.firstname",
          required: false,
          description: "First name.",
        },
        {
          key: "lastname",
          in: "body",
          target: "properties.lastname",
          required: false,
          description: "Last name.",
        },
      ],
    },
  ],
};
