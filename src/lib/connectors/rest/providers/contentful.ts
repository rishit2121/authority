import type { RestConnectorSpec } from "../spec";

/**
 * https://www.contentful.com/developers/docs/references/content-management-api/ -- personal access tokens are sent as
 * `Authorization: Bearer <token>`.
 */
export const contentful: RestConnectorSpec = {
  id: "contentful",
  name: "Contentful",
  description: "Read-only: list spaces and content types, and list or read entries.",
  category: "Content & design",
  docsUrl: "https://www.contentful.com/developers/docs/references/content-management-api/",
  iconSlug: "contentful",
  host: "api.contentful.com",
  credential: {
    label: "Personal access token",
    help: "Contentful → Account settings → CMA tokens → Create personal access token. Spaces on the EU data residency host (api.eu.contentful.com) aren't supported.",
    placeholder: "CFPAT-…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/users/me" },
  operations: [
    {
      slug: "list_spaces",
      summary: "Lists the spaces the token can access.",
      method: "GET",
      path: "/spaces",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_content_types",
      summary: "Lists the content types in one space environment.",
      method: "GET",
      path: "/spaces/{space_id}/environments/{environment_id}/content_types",
      sideEffect: "read",
      resourceType: "space",
      resource: "space_id",
      args: [
        { key: "space_id", in: "path", required: true, description: "The space id." },
        {
          key: "environment_id",
          in: "path",
          required: true,
          description: "The environment id, usually master.",
        },
      ],
    },
    {
      slug: "list_entries",
      summary: "Lists entries in one space environment, optionally of one content type.",
      method: "GET",
      path: "/spaces/{space_id}/environments/{environment_id}/entries",
      sideEffect: "read",
      resourceType: "space",
      resource: "space_id",
      args: [
        { key: "space_id", in: "path", required: true, description: "The space id." },
        {
          key: "environment_id",
          in: "path",
          required: true,
          description: "The environment id, usually master.",
        },
        {
          key: "content_type",
          in: "query",
          required: false,
          description: "Only entries of this content type id.",
        },
        {
          key: "limit",
          in: "query",
          type: "number",
          required: false,
          description: "Page size (at most 1000).",
        },
        {
          key: "skip",
          in: "query",
          type: "number",
          required: false,
          description: "Number of entries to skip.",
        },
      ],
    },
    {
      slug: "get_entry",
      summary: "Returns one entry's fields and publishing state.",
      method: "GET",
      path: "/spaces/{space_id}/environments/{environment_id}/entries/{entry_id}",
      sideEffect: "read",
      resourceType: "entry",
      resource: "entry_id",
      args: [
        { key: "space_id", in: "path", required: true, description: "The space id." },
        {
          key: "environment_id",
          in: "path",
          required: true,
          description: "The environment id, usually master.",
        },
        { key: "entry_id", in: "path", required: true, description: "The entry id." },
      ],
    },
  ],
};
