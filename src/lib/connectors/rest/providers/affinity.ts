import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.affinity.co/pages/external-api-v2/authentication -- API v2 keys are sent as
 * `Authorization: Bearer <key>` to api.affinity.co.
 */
export const affinity: RestConnectorSpec = {
  id: "affinity",
  name: "Affinity",
  description: "Read people and companies and their notes, and add a note to a person.",
  category: "CRM & sales",
  docsUrl: "https://developer.affinity.co/api-reference/2024-01-01/persons/get-a-single-person",
  host: "api.affinity.co",
  basePath: "/v2",
  credential: {
    label: "API key",
    help: "Settings → Manage Apps → generate an API key (needs the “Generate an API key” permission).",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/auth/whoami" },
  operations: [
    {
      slug: "get_person",
      summary: "Returns one person's basic information.",
      method: "GET",
      path: "/persons/{person_id}",
      sideEffect: "read",
      resourceType: "person",
      resource: "person_id",
      dataSensitivity: "confidential",
      args: [{ key: "person_id", in: "path", type: "number", required: true, description: "The person id." }],
    },
    {
      slug: "get_company",
      summary: "Returns one company's basic information.",
      method: "GET",
      path: "/companies/{company_id}",
      sideEffect: "read",
      resourceType: "company",
      resource: "company_id",
      args: [
        { key: "company_id", in: "path", type: "number", required: true, description: "The company id." },
      ],
    },
    {
      slug: "list_person_notes",
      summary: "Lists the notes attached to or mentioning one person.",
      method: "GET",
      path: "/persons/{person_id}/notes",
      sideEffect: "read",
      resourceType: "person",
      resource: "person_id",
      dataSensitivity: "confidential",
      args: [{ key: "person_id", in: "path", type: "number", required: true, description: "The person id." }],
    },
    {
      slug: "add_person_note",
      summary: "Adds one note attached to a person, authored by the key's user.",
      method: "POST",
      path: "/notes",
      sideEffect: "write_create",
      resourceType: "person",
      resource: "person_id",
      fixedBody: { type: "entities" },
      args: [
        {
          key: "person_id",
          in: "body",
          target: "persons.0.id",
          type: "number",
          required: true,
          description: "The person id.",
        },
        {
          key: "html",
          in: "body",
          target: "content.html",
          required: true,
          freeText: true,
          description: "Note body as simple HTML, e.g. <p>…</p>.",
        },
      ],
    },
  ],
};
