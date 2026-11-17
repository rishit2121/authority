import type { RestConnectorSpec } from "../spec";

/**
 * https://launchdarkly.com/docs/api -- access tokens are sent as the raw `Authorization: <token>` header value.
 * Read-only: flag changes need a semantic-patch content type the generic connector does not send.
 */
export const launchdarkly: RestConnectorSpec = {
  id: "launchdarkly",
  name: "LaunchDarkly",
  description: "List projects and feature flags, read a flag, and check flag statuses in an environment.",
  category: "Developer tools",
  docsUrl: "https://launchdarkly.com/docs/api/feature-flags",
  host: "app.launchdarkly.com",
  basePath: "/api/v2",
  credential: {
    label: "Access token",
    help: "LaunchDarkly → Organization settings → Authorization → Create token (a Reader role is enough).",
    placeholder: "api-…",
  },
  auth: { headers: { Authorization: "{key}" } },
  verify: { method: "GET", path: "/caller-identity" },
  operations: [
    {
      slug: "list_projects",
      summary: "Lists the account's projects (keys and names).",
      method: "GET",
      path: "/projects",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_flags",
      summary: "Lists the feature flags in one project.",
      method: "GET",
      path: "/flags/{project_key}",
      sideEffect: "read",
      resourceType: "project",
      resource: "project_key",
      args: [
        { key: "project_key", in: "path", required: true, description: "The project key." },
        {
          key: "env",
          in: "query",
          required: false,
          description: "Only include configuration for this environment key, e.g. production.",
        },
      ],
    },
    {
      slug: "get_flag",
      summary: "Returns one feature flag's variations, targeting and per-environment state.",
      method: "GET",
      path: "/flags/{project_key}/{flag_key}",
      sideEffect: "read",
      resourceType: "flag",
      resource: "flag_key",
      args: [
        { key: "project_key", in: "path", required: true, description: "The project key." },
        { key: "flag_key", in: "path", required: true, description: "The feature flag key." },
        {
          key: "env",
          in: "query",
          required: false,
          description: "Only include configuration for this environment key, e.g. production.",
        },
      ],
    },
    {
      slug: "list_flag_statuses",
      summary: "Lists whether each flag in one environment is new, active, inactive or launched.",
      method: "GET",
      path: "/flag-statuses/{project_key}/{environment_key}",
      sideEffect: "read",
      resourceType: "environment",
      resource: "environment_key",
      args: [
        { key: "project_key", in: "path", required: true, description: "The project key." },
        {
          key: "environment_key",
          in: "path",
          required: true,
          description: "The environment key, e.g. production.",
        },
      ],
    },
  ],
};
