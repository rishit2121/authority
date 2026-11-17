import type { RestConnectorSpec } from "../spec";

/**
 * https://streak.readme.io/docs/authentication -- basic auth with the API key as the username and an empty password,
 * against api.streak.com.
 */
export const streak: RestConnectorSpec = {
  id: "streak",
  name: "Streak",
  description: "List pipelines, read a box, and comment on a box.",
  category: "CRM & sales",
  docsUrl: "https://streak.readme.io/reference/get-a-box",
  host: "api.streak.com",
  basePath: "/api",
  credential: {
    label: "API key",
    help: "In Gmail: Streak sidebar → Integrations → Streak API → Create New Key.",
  },
  auth: { basic: { username: "{key}", password: "" } },
  verify: { method: "GET", path: "/v1/users/me" },
  operations: [
    {
      slug: "list_pipelines",
      summary: "Lists the pipelines you can access.",
      method: "GET",
      path: "/v1/pipelines",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_box",
      summary: "Returns one box (a deal, lead or other pipeline item) with its stage and fields.",
      method: "GET",
      path: "/v1/boxes/{box_key}",
      sideEffect: "read",
      resourceType: "box",
      resource: "box_key",
      dataSensitivity: "confidential",
      args: [{ key: "box_key", in: "path", required: true, description: "The box key." }],
    },
    {
      slug: "add_comment",
      summary: "Adds one comment to a box; only your team sees it.",
      method: "POST",
      path: "/v2/boxes/{box_key}/comments",
      sideEffect: "write_create",
      resourceType: "box",
      resource: "box_key",
      args: [
        { key: "box_key", in: "path", required: true, description: "The box key." },
        { key: "message", in: "body", required: true, freeText: true, description: "Comment text." },
      ],
    },
  ],
};
