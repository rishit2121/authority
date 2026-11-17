import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.capsulecrm.com/v2/overview/authentication -- personal access tokens are sent as
 * `Authorization: Bearer <token>` to api.capsulecrm.com.
 */
export const capsule: RestConnectorSpec = {
  id: "capsule",
  name: "Capsule",
  description: "Search and read people and organisations, read their history, and add a note.",
  category: "CRM & sales",
  docsUrl: "https://developer.capsulecrm.com/v2/operations/Party",
  host: "api.capsulecrm.com",
  basePath: "/api/v2",
  credential: {
    label: "Personal access token",
    help: "In Capsule: My Preferences → API Authentication Tokens → generate a new token.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/users/current" },
  operations: [
    {
      slug: "search_parties",
      summary: "Searches people and organisations, like the global search in Capsule.",
      method: "GET",
      path: "/parties/search",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "q",
          in: "query",
          required: true,
          description: "Name, email, phone or postcode to search for.",
        },
      ],
    },
    {
      slug: "get_party",
      summary: "Returns one person or organisation.",
      method: "GET",
      path: "/parties/{party_id}",
      sideEffect: "read",
      resourceType: "party",
      resource: "party_id",
      dataSensitivity: "confidential",
      args: [{ key: "party_id", in: "path", type: "number", required: true, description: "The party id." }],
    },
    {
      slug: "list_party_entries",
      summary: "Lists the notes, emails and completed tasks on one party's history.",
      method: "GET",
      path: "/parties/{party_id}/entries",
      sideEffect: "read",
      resourceType: "party",
      resource: "party_id",
      dataSensitivity: "confidential",
      args: [{ key: "party_id", in: "path", type: "number", required: true, description: "The party id." }],
    },
    {
      slug: "add_note",
      summary: "Adds one note to a party's history.",
      method: "POST",
      path: "/entries",
      sideEffect: "write_create",
      resourceType: "party",
      resource: "party_id",
      args: [
        {
          key: "party_id",
          in: "body",
          target: "entry.party.id",
          type: "number",
          required: true,
          description: "The party id.",
        },
        {
          key: "entry_type",
          in: "body",
          target: "entry.type",
          required: true,
          description: 'Must be "note" (the only type Capsule accepts here).',
        },
        {
          key: "content",
          in: "body",
          target: "entry.content",
          required: true,
          freeText: true,
          description: "Note text.",
        },
      ],
    },
  ],
};
