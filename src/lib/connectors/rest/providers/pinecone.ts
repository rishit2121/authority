import type { RestConnectorSpec } from "../spec";

/**
 * https://docs.pinecone.io/reference/api/2026-07/control-plane/list_indexes -- `Api-Key: <key>` header, with a pinned
 * `X-Pinecone-Api-Version`.
 */
export const pinecone: RestConnectorSpec = {
  id: "pinecone",
  name: "Pinecone",
  description: "Read-only: list indexes and collections, and describe one index.",
  category: "AI & ML",
  docsUrl: "https://docs.pinecone.io/reference/api/2026-07/control-plane/list_indexes",
  host: "api.pinecone.io",
  credential: {
    label: "API key",
    help: "Pinecone console → your project → API keys → Create API key.",
    placeholder: "pcsk_…",
  },
  auth: { headers: { "Api-Key": "{key}" } },
  headers: { "X-Pinecone-Api-Version": "2026-07" },
  verify: { method: "GET", path: "/indexes" },
  operations: [
    {
      slug: "list_indexes",
      summary: "Lists the project's indexes with their dimension, metric, host and status.",
      method: "GET",
      path: "/indexes",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "describe_index",
      summary: "Returns one index's configuration, host and status.",
      method: "GET",
      path: "/indexes/{index_name}",
      sideEffect: "read",
      resourceType: "index",
      resource: "index_name",
      args: [{ key: "index_name", in: "path", required: true, description: "The index name." }],
    },
    {
      slug: "list_collections",
      summary: "Lists the project's collections (pod-based index snapshots).",
      method: "GET",
      path: "/collections",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
  ],
};
