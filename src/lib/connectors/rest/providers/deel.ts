import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.deel.com/api/stable/authentication -- organization or personal API tokens are sent as
 * `Authorization: Bearer <token>`.
 */
export const deel: RestConnectorSpec = {
  id: "deel",
  name: "Deel",
  description: "Read-only: list and read contracts and people.",
  category: "HR & recruiting",
  docsUrl: "https://developer.deel.com/api/stable/authentication",
  host: "api.letsdeel.com",
  basePath: "/rest",
  credential: {
    label: "API token",
    help: "Deel → Developer Center → Access tokens → create an organization token with read scopes for contracts and people.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/organizations" },
  operations: [
    {
      slug: "list_contracts",
      summary: "Lists the organization's contracts.",
      method: "GET",
      path: "/contracts",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        { key: "limit", in: "query", required: false, description: "Page size (default 50)." },
        {
          key: "after_cursor",
          in: "query",
          required: false,
          description: "Cursor from a previous response.",
        },
      ],
    },
    {
      slug: "get_contract",
      summary: "Returns one contract's type, status, worker and terms.",
      method: "GET",
      path: "/contracts/{contract_id}",
      sideEffect: "read",
      resourceType: "contract",
      resource: "contract_id",
      dataSensitivity: "confidential",
      args: [{ key: "contract_id", in: "path", required: true, description: "The contract id." }],
    },
    {
      slug: "list_people",
      summary: "Lists people in the organization, optionally matching a name.",
      method: "GET",
      path: "/people",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        { key: "search", in: "query", required: false, description: "Matches by name." },
        { key: "limit", in: "query", type: "number", required: false, description: "Page size." },
        {
          key: "offset",
          in: "query",
          type: "number",
          required: false,
          description: "Number of records to skip.",
        },
      ],
    },
    {
      slug: "get_person",
      summary: "Returns one person's HR profile.",
      method: "GET",
      path: "/people/{person_id}",
      sideEffect: "read",
      resourceType: "person",
      resource: "person_id",
      dataSensitivity: "confidential",
      args: [{ key: "person_id", in: "path", required: true, description: "The person's HRIS profile id." }],
    },
  ],
};
