import type { RestConnectorSpec } from "../spec";

/**
 * https://www.storyblok.com/docs/api/management -- personal access tokens are sent as the raw `Authorization` header
 * (no scheme), against the space region's Management API host.
 */
export const storyblok: RestConnectorSpec = {
  id: "storyblok",
  name: "Storyblok",
  description: "Read-only: list spaces, and list or read stories in a space.",
  category: "Content & design",
  docsUrl: "https://www.storyblok.com/docs/api/management",
  iconSlug: "storyblok",
  host: "{config.region_host}.storyblok.com",
  basePath: "/v1",
  credential: {
    label: "Personal access token",
    help: "Storyblok → My account → Account settings → Personal access token → Generate new token.",
  },
  configFields: [
    {
      key: "region_host",
      label: "Region",
      placeholder: "mapi",
      help: "mapi (EU), api-us (US), api-ca (Canada) or api-ap (Australia), matching your space's server location.",
      pattern: "^(mapi|api-us|api-ca|api-ap)$",
    },
  ],
  auth: { headers: { Authorization: "{key}" } },
  verify: { method: "GET", path: "/spaces" },
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
      slug: "list_stories",
      summary: "Lists stories in one space, optionally by slug prefix or search term.",
      method: "GET",
      path: "/spaces/{space_id}/stories",
      sideEffect: "read",
      resourceType: "space",
      resource: "space_id",
      args: [
        { key: "space_id", in: "path", type: "number", required: true, description: "The numeric space id." },
        {
          key: "starts_with",
          in: "query",
          required: false,
          description: "Only stories whose full slug starts with this.",
        },
        {
          key: "text_search",
          in: "query",
          required: false,
          description: "Search term matched against story content.",
        },
        { key: "page", in: "query", type: "number", required: false, description: "Page number." },
        {
          key: "per_page",
          in: "query",
          type: "number",
          required: false,
          description: "Page size (default 25).",
        },
      ],
    },
    {
      slug: "get_story",
      summary: "Returns one story's content and publishing state.",
      method: "GET",
      path: "/spaces/{space_id}/stories/{story_id}",
      sideEffect: "read",
      resourceType: "story",
      resource: "story_id",
      args: [
        { key: "space_id", in: "path", type: "number", required: true, description: "The numeric space id." },
        { key: "story_id", in: "path", type: "number", required: true, description: "The numeric story id." },
      ],
    },
  ],
};
