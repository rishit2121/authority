import type { RestConnectorSpec } from "../spec";

/** https://vercel.com/docs/rest-api -- access tokens are sent as `Authorization: Bearer <token>`. */
export const vercel: RestConnectorSpec = {
  id: "vercel",
  name: "Vercel",
  description: "List and read deployments and their build events, and cancel a deployment.",
  category: "Cloud & infrastructure",
  docsUrl: "https://vercel.com/docs/rest-api/reference",
  iconSlug: "vercel",
  host: "api.vercel.com",
  credential: {
    label: "Access token",
    help: "Vercel → Account Settings → Tokens → Create, scoped to the team it should reach.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/v2/user" },
  operations: [
    {
      slug: "list_deployments",
      summary: "Lists recent deployments, optionally for one project or team.",
      method: "GET",
      path: "/v7/deployments",
      sideEffect: "read",
      resourceType: "account",
      args: [
        {
          key: "project_id",
          in: "query",
          target: "projectId",
          required: false,
          description: "Only deployments of this project id or name.",
        },
        {
          key: "state",
          in: "query",
          required: false,
          description: "Comma-separated states, e.g. ERROR,BUILDING,READY.",
        },
        {
          key: "team_id",
          in: "query",
          target: "teamId",
          required: false,
          description: "The team id to act on (omit for personal account).",
        },
      ],
    },
    {
      slug: "get_deployment",
      summary: "Returns one deployment's state, URL, target and git metadata.",
      method: "GET",
      path: "/v13/deployments/{deployment_id}",
      sideEffect: "read",
      resourceType: "deployment",
      resource: "deployment_id",
      args: [
        {
          key: "deployment_id",
          in: "path",
          required: true,
          description: "The deployment id (dpl_…) or its hostname.",
        },
        {
          key: "team_id",
          in: "query",
          target: "teamId",
          required: false,
          description: "The team id to act on (omit for personal account).",
        },
      ],
    },
    {
      slug: "get_deployment_events",
      summary: "Returns one deployment's build log events.",
      method: "GET",
      path: "/v3/deployments/{deployment_id}/events",
      sideEffect: "read",
      resourceType: "deployment",
      resource: "deployment_id",
      args: [
        {
          key: "deployment_id",
          in: "path",
          required: true,
          description: "The deployment id (dpl_…) or its hostname.",
        },
        {
          key: "team_id",
          in: "query",
          target: "teamId",
          required: false,
          description: "The team id to act on (omit for personal account).",
        },
      ],
    },
    {
      slug: "cancel_deployment",
      summary: "Cancels one deployment that is still building.",
      method: "PATCH",
      path: "/v12/deployments/{deployment_id}/cancel",
      sideEffect: "write_update",
      resourceType: "deployment",
      resource: "deployment_id",
      args: [
        { key: "deployment_id", in: "path", required: true, description: "The deployment id (dpl_…)." },
        {
          key: "team_id",
          in: "query",
          target: "teamId",
          required: false,
          description: "The team id to act on (omit for personal account).",
        },
      ],
    },
  ],
};
