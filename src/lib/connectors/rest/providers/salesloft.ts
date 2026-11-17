import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.salesloft.com/docs/platform/api-basics/api-key-authentication/ -- API keys are sent as
 * `Authorization: Bearer <key>` to api.salesloft.com.
 */
export const salesloft: RestConnectorSpec = {
  id: "salesloft",
  name: "Salesloft",
  description: "Look up and read people, and add a note to a person.",
  category: "CRM & sales",
  docsUrl: "https://developers.salesloft.com/docs/api/people-index/",
  host: "api.salesloft.com",
  basePath: "/v2",
  credential: {
    label: "API key",
    help: "Your Applications → API Keys → Create New, with people read and notes write scopes.",
    placeholder: "ak_…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/me" },
  operations: [
    {
      slug: "find_people_by_email",
      summary: "Lists the people with this email address.",
      method: "GET",
      path: "/people",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "email",
          in: "query",
          target: "email_addresses[]",
          required: true,
          description: "The person's email.",
        },
      ],
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
      slug: "add_person_note",
      summary: "Adds one note to a person.",
      method: "POST",
      path: "/notes",
      sideEffect: "write_create",
      resourceType: "person",
      resource: "person_id",
      fixedBody: { associated_with_type: "person" },
      args: [
        {
          key: "person_id",
          in: "body",
          target: "associated_with_id",
          type: "number",
          required: true,
          description: "The person id.",
        },
        { key: "content", in: "body", required: true, freeText: true, description: "Note text." },
      ],
    },
  ],
};
