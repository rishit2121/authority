import type { RestConnectorSpec } from "../spec";

/**
 * https://docs.attio.com/rest-api/overview -- workspace API keys are sent as `Authorization: Bearer <token>` to
 * api.attio.com.
 */
export const attio: RestConnectorSpec = {
  id: "attio",
  name: "Attio",
  description: "Search and read people, companies and other records, and add a note to one.",
  category: "CRM & sales",
  docsUrl: "https://docs.attio.com/rest-api/endpoint-reference/records/search-records",
  host: "api.attio.com",
  basePath: "/v2",
  credential: {
    label: "API key",
    help: "Workspace settings → Developers → create an access token with record and note read/write scopes.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  // `/v2/self` answers 200 even for revoked tokens, so verify with a call that rejects a bad one.
  verify: { method: "GET", path: "/objects" },
  operations: [
    {
      slug: "search_records",
      summary: "Fuzzy-searches records of the given objects by name, domain, email or phone.",
      method: "POST",
      path: "/objects/records/search",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      fixedBody: { request_as: { type: "workspace" } },
      args: [
        { key: "query", in: "body", required: true, description: "Text to search for." },
        {
          key: "objects",
          in: "body",
          type: "stringArray",
          required: true,
          description: "Object slugs to search, e.g. people, companies, deals.",
        },
        { key: "limit", in: "body", type: "number", required: false, description: "Maximum results (1-25)." },
      ],
    },
    {
      slug: "get_record",
      summary: "Returns one record and its attribute values.",
      method: "GET",
      path: "/objects/{object}/records/{record_id}",
      sideEffect: "read",
      resourceType: "record",
      resource: "record_id",
      dataSensitivity: "confidential",
      args: [
        { key: "object", in: "path", required: true, description: "Object slug, e.g. people or companies." },
        { key: "record_id", in: "path", required: true, description: "The record's UUID." },
      ],
    },
    {
      slug: "create_note",
      summary: "Adds one note to a record.",
      method: "POST",
      path: "/notes",
      sideEffect: "write_create",
      resourceType: "record",
      resource: "parent_record_id",
      args: [
        {
          key: "parent_object",
          in: "body",
          target: "data.parent_object",
          required: true,
          description: "Object slug of the parent record, e.g. people.",
        },
        {
          key: "parent_record_id",
          in: "body",
          target: "data.parent_record_id",
          required: true,
          description: "The parent record's UUID.",
        },
        {
          key: "format",
          in: "body",
          target: "data.format",
          required: true,
          description: 'Content format: "plaintext" or "markdown".',
        },
        {
          key: "title",
          in: "body",
          target: "data.title",
          required: true,
          freeText: true,
          description: "Note title (plain text).",
        },
        {
          key: "content",
          in: "body",
          target: "data.content",
          required: true,
          freeText: true,
          description: "Note body.",
        },
      ],
    },
  ],
};
