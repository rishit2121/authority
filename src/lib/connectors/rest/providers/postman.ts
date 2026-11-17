import type { RestConnectorSpec } from "../spec";

/** https://learning.postman.com/docs/developer/postman-api/authentication/ -- API keys go in the `X-API-Key` header. */
export const postman: RestConnectorSpec = {
  id: "postman",
  name: "Postman",
  description: "List workspaces and collections, read a collection, and comment on one.",
  category: "Developer tools",
  docsUrl: "https://learning.postman.com/api-docs/api-reference",
  iconSlug: "postman",
  host: "api.postman.com",
  credential: {
    label: "API key",
    help: "Postman → Settings → API keys → Generate API Key.",
    placeholder: "PMAK-…",
  },
  auth: { headers: { "X-API-Key": "{key}" } },
  verify: { method: "GET", path: "/me" },
  operations: [
    {
      slug: "list_workspaces",
      summary: "Lists the workspaces the account can access.",
      method: "GET",
      path: "/workspaces",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_collections",
      summary: "Lists collections, optionally only those in one workspace.",
      method: "GET",
      path: "/collections",
      sideEffect: "read",
      resourceType: "account",
      args: [
        {
          key: "workspace",
          in: "query",
          required: false,
          description: "Only collections in this workspace id.",
        },
      ],
    },
    {
      slug: "get_collection",
      summary: "Returns one collection's folders, requests and examples.",
      method: "GET",
      path: "/collections/{collection_id}",
      sideEffect: "read",
      resourceType: "collection",
      resource: "collection_id",
      // Saved requests can include auth values and example payloads.
      dataSensitivity: "confidential",
      args: [
        { key: "collection_id", in: "path", required: true, description: "The collection's id or uid." },
      ],
    },
    {
      slug: "comment_on_collection",
      summary: "Adds one comment to a collection.",
      method: "POST",
      path: "/collections/{collection_id}/comments",
      sideEffect: "write_create",
      resourceType: "collection",
      resource: "collection_id",
      args: [
        { key: "collection_id", in: "path", required: true, description: "The collection's uid." },
        {
          key: "body",
          in: "body",
          required: true,
          freeText: true,
          description: "Comment text (max 10,000 characters).",
        },
      ],
    },
  ],
};
