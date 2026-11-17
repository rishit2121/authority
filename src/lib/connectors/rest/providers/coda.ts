import type { RestConnectorSpec } from "../spec";

/**
 * https://docs.superhuman.com/developers/apis/v1 (Coda is now Superhuman Docs) -- API tokens are sent as
 * `Authorization: Bearer <token>`.
 */
export const coda: RestConnectorSpec = {
  id: "coda",
  name: "Coda (Superhuman Docs)",
  description: "List docs and their tables, list rows in a table, and read one row.",
  category: "Productivity",
  docsUrl: "https://docs.superhuman.com/developers/apis/v1",
  iconSlug: "coda",
  host: "docs.superhuman.com",
  basePath: "/apis/v1",
  credential: {
    label: "API token",
    help: "Account settings → API settings → Generate API token (you can restrict it to read access and specific docs).",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/whoami" },
  operations: [
    {
      slug: "list_docs",
      summary: "Lists the docs the token can access, optionally matching a search term.",
      method: "GET",
      path: "/docs",
      sideEffect: "read",
      resourceType: "account",
      args: [{ key: "query", in: "query", required: false, description: "Search term docs must match." }],
    },
    {
      slug: "list_tables",
      summary: "Lists the tables and views in one doc.",
      method: "GET",
      path: "/docs/{doc_id}/tables",
      sideEffect: "read",
      resourceType: "doc",
      resource: "doc_id",
      args: [{ key: "doc_id", in: "path", required: true, description: "The doc's id." }],
    },
    {
      slug: "list_rows",
      summary: "Lists rows in one table, keyed by column name.",
      method: "GET",
      path: "/docs/{doc_id}/tables/{table_id}/rows",
      sideEffect: "read",
      resourceType: "table",
      resource: "table_id",
      dataSensitivity: "confidential",
      args: [
        { key: "doc_id", in: "path", required: true, description: "The doc's id." },
        { key: "table_id", in: "path", required: true, description: "The table's id (grid-…) or name." },
        { key: "query", in: "query", required: false, description: "Row filter as <column>:<value>." },
        {
          key: "limit",
          in: "query",
          type: "number",
          required: false,
          description: "Maximum rows to return.",
        },
      ],
      fixedQuery: { useColumnNames: "true" },
    },
    {
      slug: "get_row",
      summary: "Returns one row's values, keyed by column name.",
      method: "GET",
      path: "/docs/{doc_id}/tables/{table_id}/rows/{row_id}",
      sideEffect: "read",
      resourceType: "row",
      resource: "row_id",
      dataSensitivity: "confidential",
      args: [
        { key: "doc_id", in: "path", required: true, description: "The doc's id." },
        { key: "table_id", in: "path", required: true, description: "The table's id (grid-…) or name." },
        { key: "row_id", in: "path", required: true, description: "The row's id (i-…)." },
      ],
      fixedQuery: { useColumnNames: "true" },
    },
  ],
};
