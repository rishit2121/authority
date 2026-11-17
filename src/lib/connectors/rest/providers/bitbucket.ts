import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.atlassian.com/cloud/bitbucket/rest/ -- Atlassian API tokens use basic auth with the Atlassian
 * account email as the username and the token as the password.
 */
export const bitbucket: RestConnectorSpec = {
  id: "bitbucket",
  name: "Bitbucket",
  description: "List and read a repository's pull requests and comment on one.",
  category: "Developer tools",
  docsUrl: "https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/",
  iconSlug: "bitbucket",
  host: "api.bitbucket.org",
  basePath: "/2.0",
  credential: {
    label: "API token",
    help: "Atlassian account settings → Security → Create API token with scopes → Bitbucket, with read:user:bitbucket, read:pullrequest:bitbucket and write:pullrequest:bitbucket.",
  },
  configFields: [
    {
      key: "email",
      label: "Atlassian account email",
      placeholder: "you@company.com",
      help: "The account the API token belongs to.",
      pattern: "^[^\\s@/:]+@[^\\s@/:]+\\.[^\\s@/:]+$",
    },
  ],
  auth: { basic: { username: "{config.email}", password: "{key}" } },
  verify: { method: "GET", path: "/user" },
  operations: [
    {
      slug: "list_pull_requests",
      summary: "Lists pull requests in one repository, optionally filtered by state.",
      method: "GET",
      path: "/repositories/{workspace}/{repo_slug}/pullrequests",
      sideEffect: "read",
      resourceType: "repository",
      resource: "repo_slug",
      args: [
        { key: "workspace", in: "path", required: true, description: "The workspace slug." },
        { key: "repo_slug", in: "path", required: true, description: "The repository slug." },
        { key: "state", in: "query", required: false, description: "OPEN, MERGED, DECLINED or SUPERSEDED." },
      ],
    },
    {
      slug: "get_pull_request",
      summary: "Returns one pull request's title, description, state, branches and reviewers.",
      method: "GET",
      path: "/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}",
      sideEffect: "read",
      resourceType: "pull_request",
      resource: "pull_request_id",
      args: [
        { key: "workspace", in: "path", required: true, description: "The workspace slug." },
        { key: "repo_slug", in: "path", required: true, description: "The repository slug." },
        {
          key: "pull_request_id",
          in: "path",
          type: "number",
          required: true,
          description: "The pull request id.",
        },
      ],
    },
    {
      slug: "list_pull_request_comments",
      summary: "Lists the comments on one pull request.",
      method: "GET",
      path: "/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/comments",
      sideEffect: "read",
      resourceType: "pull_request",
      resource: "pull_request_id",
      args: [
        { key: "workspace", in: "path", required: true, description: "The workspace slug." },
        { key: "repo_slug", in: "path", required: true, description: "The repository slug." },
        {
          key: "pull_request_id",
          in: "path",
          type: "number",
          required: true,
          description: "The pull request id.",
        },
      ],
    },
    {
      slug: "comment_on_pull_request",
      summary: "Adds one comment to a pull request.",
      method: "POST",
      path: "/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/comments",
      sideEffect: "write_create",
      resourceType: "pull_request",
      resource: "pull_request_id",
      args: [
        { key: "workspace", in: "path", required: true, description: "The workspace slug." },
        { key: "repo_slug", in: "path", required: true, description: "The repository slug." },
        {
          key: "pull_request_id",
          in: "path",
          type: "number",
          required: true,
          description: "The pull request id.",
        },
        {
          key: "body",
          in: "body",
          target: "content.raw",
          required: true,
          freeText: true,
          description: "Comment text (Markdown).",
        },
      ],
    },
  ],
};
