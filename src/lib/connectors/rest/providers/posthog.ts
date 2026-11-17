import type { RestConnectorSpec } from "../spec";

/**
 * https://posthog.com/docs/api -- personal API keys are sent as `Authorization: Bearer <key>` against the cloud
 * region's `{us|eu}.posthog.com`. Read-only.
 */
export const posthog: RestConnectorSpec = {
  id: "posthog",
  name: "PostHog",
  description: "List and read saved insights, list event definitions, and look up persons in a project.",
  category: "Analytics",
  docsUrl: "https://posthog.com/docs/api",
  iconSlug: "posthog",
  host: "{config.region}.posthog.com",
  credential: {
    label: "Personal API key",
    help: "PostHog → Settings → Personal API keys → Create. Scopes: user:read, insight:read, event_definition:read, person:read.",
    placeholder: "phx_…",
  },
  configFields: [
    {
      key: "region",
      label: "Cloud region",
      placeholder: "us",
      help: "us for us.posthog.com, eu for eu.posthog.com.",
      pattern: "^(us|eu)$",
    },
  ],
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/api/users/@me/" },
  operations: [
    {
      slug: "list_insights",
      summary: "Lists the saved insights in one project.",
      method: "GET",
      path: "/api/projects/{project_id}/insights/",
      sideEffect: "read",
      resourceType: "project",
      resource: "project_id",
      args: [
        { key: "project_id", in: "path", type: "number", required: true, description: "The project id." },
      ],
    },
    {
      slug: "get_insight",
      summary: "Returns one saved insight's definition and results.",
      method: "GET",
      path: "/api/projects/{project_id}/insights/{insight_id}/",
      sideEffect: "read",
      resourceType: "insight",
      resource: "insight_id",
      args: [
        { key: "project_id", in: "path", type: "number", required: true, description: "The project id." },
        { key: "insight_id", in: "path", type: "number", required: true, description: "The insight id." },
      ],
    },
    {
      slug: "list_event_definitions",
      summary: "Lists the event names seen in one project, with volumes.",
      method: "GET",
      path: "/api/projects/{project_id}/event_definitions/",
      sideEffect: "read",
      resourceType: "project",
      resource: "project_id",
      args: [
        { key: "project_id", in: "path", type: "number", required: true, description: "The project id." },
      ],
    },
    {
      slug: "list_persons",
      summary: "Lists persons in one project, optionally only one email or distinct id.",
      method: "GET",
      path: "/api/projects/{project_id}/persons/",
      sideEffect: "read",
      resourceType: "project",
      resource: "project_id",
      dataSensitivity: "confidential",
      args: [
        { key: "project_id", in: "path", type: "number", required: true, description: "The project id." },
        { key: "email", in: "query", required: false, description: "Only the person with this email." },
        {
          key: "distinct_id",
          in: "query",
          required: false,
          description: "Only the person with this distinct id.",
        },
      ],
    },
  ],
};
