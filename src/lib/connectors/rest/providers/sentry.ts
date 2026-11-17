import type { RestConnectorSpec } from "../spec";

/** https://docs.sentry.io/api/ -- auth tokens are sent as `Authorization: Bearer <token>`. */
export const sentry: RestConnectorSpec = {
  id: "sentry",
  name: "Sentry",
  description: "List projects and issues, read an issue, and resolve it.",
  category: "Developer tools",
  docsUrl: "https://docs.sentry.io/api/",
  iconSlug: "sentry",
  host: "sentry.io",
  basePath: "/api/0",
  credential: {
    label: "Auth token",
    help: "Create one in Sentry under Settings → Auth Tokens (or a custom integration's token) with project:read and event:write.",
    placeholder: "sntrys_…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/organizations/" },
  operations: [
    {
      slug: "list_projects",
      summary: "Lists the projects in one organization.",
      method: "GET",
      path: "/organizations/{organization_slug}/projects/",
      sideEffect: "read",
      resourceType: "organization",
      resource: "organization_slug",
      args: [
        { key: "organization_slug", in: "path", required: true, description: "The organization's slug." },
      ],
    },
    {
      slug: "list_issues",
      summary: "Lists unresolved issues in one project.",
      method: "GET",
      path: "/projects/{organization_slug}/{project_slug}/issues/",
      sideEffect: "read",
      resourceType: "project",
      resource: "project_slug",
      args: [
        { key: "organization_slug", in: "path", required: true, description: "The organization's slug." },
        { key: "project_slug", in: "path", required: true, description: "The project's slug." },
      ],
      fixedQuery: { query: "is:unresolved" },
    },
    {
      slug: "get_issue",
      summary: "Returns one issue's title, status and counts.",
      method: "GET",
      path: "/organizations/{organization_slug}/issues/{issue_id}/",
      sideEffect: "read",
      resourceType: "issue",
      resource: "issue_id",
      args: [
        { key: "organization_slug", in: "path", required: true, description: "The organization's slug." },
        { key: "issue_id", in: "path", required: true, description: "The issue's numeric id." },
      ],
    },
    {
      slug: "resolve_issue",
      summary: "Marks one issue resolved; changes nothing else.",
      method: "PUT",
      path: "/organizations/{organization_slug}/issues/{issue_id}/",
      sideEffect: "write_update",
      resourceType: "issue",
      resource: "issue_id",
      args: [
        { key: "organization_slug", in: "path", required: true, description: "The organization's slug." },
        { key: "issue_id", in: "path", required: true, description: "The issue's numeric id." },
      ],
      fixedBody: { status: "resolved" },
    },
  ],
};
