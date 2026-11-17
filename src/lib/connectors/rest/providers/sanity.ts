import type { RestConnectorSpec } from "../spec";

/**
 * https://www.sanity.io/docs/http-reference/query -- API tokens are sent as `Authorization: Bearer <token>` against the
 * project's own `{projectId}.api.sanity.io/v2025-02-19`.
 */
export const sanity: RestConnectorSpec = {
  id: "sanity",
  name: "Sanity",
  description: "Read-only: fetch documents by id and run GROQ queries against a dataset.",
  category: "Content & design",
  docsUrl: "https://www.sanity.io/docs/http-reference/query",
  iconSlug: "sanity",
  host: "{config.project_id}.api.sanity.io",
  basePath: "/v2025-02-19",
  credential: {
    label: "API token",
    help: "sanity.io/manage → your project → API → Tokens → Add API token with Viewer permissions.",
    placeholder: "sk…",
  },
  configFields: [
    {
      key: "project_id",
      label: "Project ID",
      placeholder: "zp7mbokg",
      help: "Shown at sanity.io/manage under your project's name (lowercase letters and digits).",
      pattern: "^[a-z0-9]{5,16}$",
    },
    {
      key: "dataset",
      label: "Dataset",
      placeholder: "production",
      help: "Used to check the token; each call still names its dataset.",
      pattern: "^[a-z0-9][a-z0-9_-]{0,63}$",
    },
  ],
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/data/doc/{config.dataset}/authority-verify" },
  operations: [
    {
      slug: "get_document",
      summary: "Returns one document by id, bypassing the cache.",
      method: "GET",
      path: "/data/doc/{dataset}/{document_id}",
      sideEffect: "read",
      resourceType: "document",
      resource: "document_id",
      args: [
        { key: "dataset", in: "path", required: true, description: "The dataset name, e.g. production." },
        { key: "document_id", in: "path", required: true, description: "The document _id." },
      ],
    },
    {
      slug: "query",
      summary: "Runs one read-only GROQ query against a dataset and returns the result.",
      method: "GET",
      path: "/data/query/{dataset}",
      sideEffect: "read",
      resourceType: "dataset",
      resource: "dataset",
      args: [
        { key: "dataset", in: "path", required: true, description: "The dataset name, e.g. production." },
        {
          key: "query",
          in: "query",
          required: true,
          freeText: true,
          description: 'The GROQ query, e.g. *[_type == "post"][0...10]{title}.',
        },
      ],
    },
  ],
};
