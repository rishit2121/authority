import type { RestConnectorSpec } from "../spec";

/** The dated REST API version every Snyk call must name. */
const VERSION = "2024-10-15";

/**
 * https://docs.snyk.io/snyk-api/rest-api -- personal API tokens are sent as `Authorization: token <token>`; every
 * REST call carries a dated `version` query parameter.
 */
export const snyk: RestConnectorSpec = {
  id: "snyk",
  name: "Snyk",
  description: "List organizations, projects and security issues, and read one issue.",
  category: "Developer tools",
  docsUrl: "https://docs.snyk.io/snyk-api/reference",
  iconSlug: "snyk",
  host: "api.snyk.io",
  basePath: "/rest",
  credential: {
    label: "API token",
    help: "Snyk → Account settings → Personal Access Tokens (or a service account token). Snyk US-01 region only.",
  },
  auth: { headers: { Authorization: "token {key}" } },
  verify: { method: "GET", path: `/self?version=${VERSION}` },
  operations: [
    {
      slug: "list_orgs",
      summary: "Lists the organizations the token can access.",
      method: "GET",
      path: "/orgs",
      sideEffect: "read",
      resourceType: "account",
      args: [],
      fixedQuery: { version: VERSION },
    },
    {
      slug: "list_projects",
      summary: "Lists the projects in one organization.",
      method: "GET",
      path: "/orgs/{org_id}/projects",
      sideEffect: "read",
      resourceType: "organization",
      resource: "org_id",
      args: [{ key: "org_id", in: "path", required: true, description: "The organization's UUID." }],
      fixedQuery: { version: VERSION },
    },
    {
      slug: "list_issues",
      summary: "Lists security issues in one organization, optionally by severity or status.",
      method: "GET",
      path: "/orgs/{org_id}/issues",
      sideEffect: "read",
      resourceType: "organization",
      resource: "org_id",
      args: [
        { key: "org_id", in: "path", required: true, description: "The organization's UUID." },
        {
          key: "severity",
          in: "query",
          target: "effective_severity_level",
          required: false,
          description: "Comma-separated: info, low, medium, high, critical.",
        },
        { key: "status", in: "query", required: false, description: "open or resolved." },
      ],
      fixedQuery: { version: VERSION },
    },
    {
      slug: "get_issue",
      summary: "Returns one issue's title, severity, status and affected project.",
      method: "GET",
      path: "/orgs/{org_id}/issues/{issue_id}",
      sideEffect: "read",
      resourceType: "issue",
      resource: "issue_id",
      args: [
        { key: "org_id", in: "path", required: true, description: "The organization's UUID." },
        { key: "issue_id", in: "path", required: true, description: "The issue's UUID." },
      ],
      fixedQuery: { version: VERSION },
    },
  ],
};
