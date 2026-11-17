import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.pipedrive.com/docs/api/v1 -- the personal API token is sent in the `x-api-token` header to the
 * company's own `{companydomain}.pipedrive.com`.
 */
export const pipedrive: RestConnectorSpec = {
  id: "pipedrive",
  name: "Pipedrive",
  description: "Search and read people and deals, and add a note to one.",
  category: "CRM & sales",
  docsUrl: "https://developers.pipedrive.com/docs/api/v1",
  host: "{config.company_domain}.pipedrive.com",
  credential: {
    label: "Personal API token",
    help: "In Pipedrive: your profile → Personal preferences → API → copy your personal API token.",
  },
  configFields: [
    {
      key: "company_domain",
      label: "Company domain",
      placeholder: "acme (for acme.pipedrive.com)",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
  ],
  auth: { headers: { "x-api-token": "{key}" } },
  verify: { method: "GET", path: "/api/v1/users/me" },
  operations: [
    {
      slug: "search_persons",
      summary: "Searches people by name, email, phone or notes.",
      method: "GET",
      path: "/api/v2/persons/search",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        { key: "term", in: "query", required: true, description: "Search term (at least 2 characters)." },
      ],
    },
    {
      slug: "get_person",
      summary: "Returns one person's details.",
      method: "GET",
      path: "/api/v2/persons/{person_id}",
      sideEffect: "read",
      resourceType: "person",
      resource: "person_id",
      dataSensitivity: "confidential",
      args: [
        { key: "person_id", in: "path", type: "number", required: true, description: "The person's id." },
      ],
    },
    {
      slug: "search_deals",
      summary: "Searches deals by title, notes or custom fields.",
      method: "GET",
      path: "/api/v2/deals/search",
      sideEffect: "read",
      resourceType: "account",
      args: [
        { key: "term", in: "query", required: true, description: "Search term (at least 2 characters)." },
      ],
    },
    {
      slug: "get_deal",
      summary: "Returns one deal's details.",
      method: "GET",
      path: "/api/v2/deals/{deal_id}",
      sideEffect: "read",
      resourceType: "deal",
      resource: "deal_id",
      args: [{ key: "deal_id", in: "path", type: "number", required: true, description: "The deal's id." }],
    },
    {
      slug: "add_deal_note",
      summary: "Adds one note to a deal.",
      method: "POST",
      path: "/api/v1/notes",
      sideEffect: "write_create",
      resourceType: "deal",
      resource: "deal_id",
      args: [
        {
          key: "deal_id",
          in: "body",
          type: "number",
          required: true,
          description: "The deal to attach the note to.",
        },
        {
          key: "content",
          in: "body",
          required: true,
          freeText: true,
          description: "Note text (HTML allowed).",
        },
      ],
    },
  ],
};
