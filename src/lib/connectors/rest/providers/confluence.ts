import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.atlassian.com/cloud/confluence/rest/v2/ -- API tokens use basic auth with the Atlassian account
 * email as the username and the token as the password, against the site's own `{site}.atlassian.net/wiki`.
 */
export const confluence: RestConnectorSpec = {
  id: "confluence",
  name: "Confluence",
  description: "List spaces and pages, read a page, and add a comment to one.",
  category: "Productivity",
  docsUrl: "https://developer.atlassian.com/cloud/confluence/rest/v2/intro/",
  iconSlug: "confluence",
  host: "{config.site}.atlassian.net",
  basePath: "/wiki/api/v2",
  credential: {
    label: "API token",
    help: "Create one at id.atlassian.com → Security → API tokens. Use it with the account email below.",
  },
  configFields: [
    {
      key: "site",
      label: "Atlassian site",
      placeholder: "acme (for acme.atlassian.net)",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
    {
      key: "email",
      label: "Atlassian account email",
      placeholder: "you@company.com",
      help: "The account the API token belongs to.",
      pattern: "^[^\\s@/:]+@[^\\s@/:]+\\.[^\\s@/:]+$",
    },
  ],
  auth: { basic: { username: "{config.email}", password: "{key}" } },
  verify: { method: "GET", path: "/spaces?limit=1" },
  operations: [
    {
      slug: "list_spaces",
      summary: "Lists the spaces the account can see.",
      method: "GET",
      path: "/spaces",
      sideEffect: "read",
      resourceType: "site",
      args: [],
    },
    {
      slug: "list_pages_in_space",
      summary: "Lists the pages in one space (titles and ids, no bodies).",
      method: "GET",
      path: "/spaces/{space_id}/pages",
      sideEffect: "read",
      resourceType: "space",
      resource: "space_id",
      args: [
        {
          key: "space_id",
          in: "path",
          required: true,
          description: "The space's numeric id (from list_spaces).",
        },
      ],
    },
    {
      slug: "get_page",
      summary: "Returns one page's title and body in storage format.",
      method: "GET",
      path: "/pages/{page_id}",
      sideEffect: "read",
      resourceType: "page",
      resource: "page_id",
      args: [{ key: "page_id", in: "path", required: true, description: "The page id." }],
      fixedQuery: { "body-format": "storage" },
    },
    {
      slug: "add_page_comment",
      summary: "Adds one footer comment to a page.",
      method: "POST",
      path: "/footer-comments",
      sideEffect: "write_create",
      resourceType: "page",
      resource: "page_id",
      args: [
        { key: "page_id", in: "body", target: "pageId", required: true, description: "The page id." },
        {
          key: "body",
          in: "body",
          target: "body.value",
          required: true,
          freeText: true,
          description: "Comment text in the chosen format.",
        },
        {
          key: "representation",
          in: "body",
          target: "body.representation",
          required: true,
          description: "Format of the comment text: storage (XHTML, e.g. <p>Hi</p>) or wiki.",
        },
      ],
    },
  ],
};
