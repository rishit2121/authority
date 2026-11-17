import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.atlassian.com/cloud/jira/platform/rest/v2/ -- API tokens use basic auth with the Atlassian
 * account email as the username and the token as the password, against the site's own `{site}.atlassian.net`.
 * v2 is used because it takes plain-text descriptions and comments (v3 requires Atlassian Document Format).
 */
export const jira: RestConnectorSpec = {
  id: "jira",
  name: "Jira",
  description: "Search and read issues, open an issue, and comment on one.",
  category: "Project management",
  docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-issues/",
  iconSlug: "jira",
  host: "{config.site}.atlassian.net",
  basePath: "/rest/api/2",
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
  verify: { method: "GET", path: "/myself" },
  operations: [
    {
      slug: "search_issues",
      summary: "Finds issues matching a JQL query and returns their key fields.",
      method: "GET",
      path: "/search/jql",
      sideEffect: "read",
      resourceType: "site",
      args: [
        {
          key: "jql",
          in: "query",
          required: true,
          description: "A bounded JQL query, e.g. project = ENG AND status != Done.",
        },
        {
          key: "max_results",
          in: "query",
          target: "maxResults",
          type: "number",
          required: false,
          description: "Maximum issues to return (default 50).",
        },
      ],
      fixedQuery: { fields: "summary,status,assignee,priority,issuetype,created,updated" },
    },
    {
      slug: "get_issue",
      summary: "Returns one issue's fields, including summary, description and status.",
      method: "GET",
      path: "/issue/{issue_key}",
      sideEffect: "read",
      resourceType: "issue",
      resource: "issue_key",
      args: [
        { key: "issue_key", in: "path", required: true, description: "The issue key (e.g. ENG-123) or id." },
      ],
    },
    {
      slug: "create_issue",
      summary: "Opens one new issue in a project.",
      method: "POST",
      path: "/issue",
      sideEffect: "write_create",
      resourceType: "project",
      resource: "project_key",
      args: [
        {
          key: "project_key",
          in: "body",
          target: "fields.project.key",
          required: true,
          description: "The project key, e.g. ENG.",
        },
        {
          key: "issue_type",
          in: "body",
          target: "fields.issuetype.name",
          required: true,
          description: "Issue type name, e.g. Task or Bug.",
        },
        {
          key: "summary",
          in: "body",
          target: "fields.summary",
          required: true,
          freeText: true,
          description: "Issue summary.",
        },
        {
          key: "description",
          in: "body",
          target: "fields.description",
          required: false,
          freeText: true,
          description: "Issue description (plain text or wiki markup).",
        },
      ],
    },
    {
      slug: "add_comment",
      summary: "Adds one comment to an issue.",
      method: "POST",
      path: "/issue/{issue_key}/comment",
      sideEffect: "write_create",
      resourceType: "issue",
      resource: "issue_key",
      args: [
        { key: "issue_key", in: "path", required: true, description: "The issue key (e.g. ENG-123) or id." },
        {
          key: "body",
          in: "body",
          required: true,
          freeText: true,
          description: "Comment text (plain text or wiki markup).",
        },
      ],
    },
  ],
};
