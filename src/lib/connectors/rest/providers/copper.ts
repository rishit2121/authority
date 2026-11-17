import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.copper.com/introduction/requests.html -- the API key goes in `X-PW-AccessToken`, alongside
 * `X-PW-Application: developer_api` and the key owner's email in `X-PW-UserEmail`, to api.copper.com.
 */
export const copper: RestConnectorSpec = {
  id: "copper",
  name: "Copper",
  description: "Search and read people, look one up by email, and add a note to a record.",
  category: "CRM & sales",
  docsUrl: "https://developer.copper.com/people/list-people-search.html",
  host: "api.copper.com",
  basePath: "/developer_api/v1",
  credential: {
    label: "API key",
    help: "Settings → Integrations → API Keys → Generate API Key. Use it with the email of the user who created it below.",
  },
  configFields: [
    {
      key: "email",
      label: "Key owner's email",
      placeholder: "you@company.com",
      help: "The Copper user the API key belongs to.",
      pattern: "^[^\\s@/:]+@[^\\s@/:]+\\.[^\\s@/:]+$",
    },
  ],
  auth: { headers: { "X-PW-AccessToken": "{key}", "X-PW-UserEmail": "{config.email}" } },
  headers: { "X-PW-Application": "developer_api" },
  verify: { method: "GET", path: "/account" },
  operations: [
    {
      slug: "search_people",
      summary: "Searches people by full name.",
      method: "POST",
      path: "/people/search",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        { key: "name", in: "body", required: true, description: "Full name to search for." },
        {
          key: "page_size",
          in: "body",
          type: "number",
          required: false,
          description: "Results per page (default 20).",
        },
      ],
    },
    {
      slug: "find_person_by_email",
      summary: "Returns the person with this email address.",
      method: "POST",
      path: "/people/fetch_by_email",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [{ key: "email", in: "body", required: true, description: "The person's email." }],
    },
    {
      slug: "get_person",
      summary: "Returns one person's details.",
      method: "GET",
      path: "/people/{person_id}",
      sideEffect: "read",
      resourceType: "person",
      resource: "person_id",
      dataSensitivity: "confidential",
      args: [{ key: "person_id", in: "path", type: "number", required: true, description: "The person id." }],
    },
    {
      slug: "add_note",
      summary: "Adds one note activity to a person, company, lead or opportunity.",
      method: "POST",
      path: "/activities",
      sideEffect: "write_create",
      resourceType: "record",
      resource: "parent_id",
      fixedBody: { type: { category: "user", id: 0 } },
      args: [
        {
          key: "parent_type",
          in: "body",
          target: "parent.type",
          required: true,
          description: '"person", "company", "lead" or "opportunity".',
        },
        {
          key: "parent_id",
          in: "body",
          target: "parent.id",
          type: "number",
          required: true,
          description: "Id of the record.",
        },
        { key: "details", in: "body", required: true, freeText: true, description: "Note text." },
      ],
    },
  ],
};
