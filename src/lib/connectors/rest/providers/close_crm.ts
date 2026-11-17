import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.close.com/api/ -- API keys use basic auth with the key as the username and an empty password,
 * against api.close.com.
 */
export const closeCrm: RestConnectorSpec = {
  id: "close_crm",
  name: "Close",
  description: "List and read leads and contacts, create a lead, and add a note to one.",
  category: "CRM & sales",
  docsUrl: "https://developer.close.com/api/resources/leads/",
  host: "api.close.com",
  basePath: "/api/v1",
  credential: {
    label: "API key",
    help: "Settings → Developer → API Keys → create a new API key.",
    placeholder: "api_…",
  },
  auth: { basic: { username: "{key}", password: "" } },
  verify: { method: "GET", path: "/me/" },
  operations: [
    {
      slug: "list_leads",
      summary: "Lists leads, most recently updated first.",
      method: "GET",
      path: "/lead/",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "limit",
          in: "query",
          type: "number",
          target: "_limit",
          required: false,
          description: "Number of leads to return.",
        },
      ],
    },
    {
      slug: "get_lead",
      summary: "Returns one lead with its contacts, opportunities and tasks.",
      method: "GET",
      path: "/lead/{lead_id}/",
      sideEffect: "read",
      resourceType: "lead",
      resource: "lead_id",
      dataSensitivity: "confidential",
      args: [{ key: "lead_id", in: "path", required: true, description: "The lead id (lead_…)." }],
    },
    {
      slug: "get_contact",
      summary: "Returns one contact's name, title, emails and phones.",
      method: "GET",
      path: "/contact/{contact_id}/",
      sideEffect: "read",
      resourceType: "contact",
      resource: "contact_id",
      dataSensitivity: "confidential",
      args: [{ key: "contact_id", in: "path", required: true, description: "The contact id (cont_…)." }],
    },
    {
      slug: "create_lead",
      summary: "Creates one lead with a name and optional description.",
      method: "POST",
      path: "/lead/",
      sideEffect: "write_create",
      resourceType: "account",
      args: [
        { key: "name", in: "body", required: true, description: "Lead (usually company) name." },
        {
          key: "description",
          in: "body",
          required: false,
          freeText: true,
          description: "Free-text description.",
        },
      ],
    },
    {
      slug: "add_note",
      summary: "Adds one note activity to a lead.",
      method: "POST",
      path: "/activity/note/",
      sideEffect: "write_create",
      resourceType: "lead",
      resource: "lead_id",
      args: [
        { key: "lead_id", in: "body", required: true, description: "The lead id (lead_…)." },
        { key: "note", in: "body", required: true, freeText: true, description: "Note text." },
      ],
    },
  ],
};
