import type { RestConnectorSpec } from "../spec";

/** https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/ -- personal access tokens are sent as `Authorization: Bearer <token>`. */
export const netlify: RestConnectorSpec = {
  id: "netlify",
  name: "Netlify",
  description: "List sites and deploys, read a deploy, start a build, and cancel a deploy.",
  category: "Cloud & infrastructure",
  docsUrl: "https://open-api.netlify.com/",
  iconSlug: "netlify",
  host: "api.netlify.com",
  basePath: "/api/v1",
  credential: {
    label: "Personal access token",
    help: "Netlify → User settings → Applications → Personal access tokens → New access token.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/user" },
  operations: [
    {
      slug: "list_sites",
      summary: "Lists the sites the account can access.",
      method: "GET",
      path: "/sites",
      sideEffect: "read",
      resourceType: "account",
      // Site objects can carry legacy build settings, including environment variables.
      dataSensitivity: "confidential",
      args: [],
    },
    {
      slug: "list_site_deploys",
      summary: "Lists recent deploys of one site.",
      method: "GET",
      path: "/sites/{site_id}/deploys",
      sideEffect: "read",
      resourceType: "site",
      resource: "site_id",
      args: [
        {
          key: "site_id",
          in: "path",
          required: true,
          description: "The site id (or its netlify.app hostname).",
        },
      ],
    },
    {
      slug: "get_deploy",
      summary: "Returns one deploy's state, branch, commit and error message.",
      method: "GET",
      path: "/deploys/{deploy_id}",
      sideEffect: "read",
      resourceType: "deploy",
      resource: "deploy_id",
      args: [{ key: "deploy_id", in: "path", required: true, description: "The deploy id." }],
    },
    {
      slug: "start_build",
      summary: "Starts one new build of a site, optionally for one branch.",
      method: "POST",
      path: "/sites/{site_id}/builds",
      sideEffect: "write_create",
      resourceType: "site",
      resource: "site_id",
      args: [
        { key: "site_id", in: "path", required: true, description: "The site id." },
        {
          key: "branch",
          in: "query",
          required: false,
          description: "Branch to build; omitted builds production.",
        },
      ],
    },
    {
      slug: "cancel_deploy",
      summary: "Cancels one deploy that is still in progress.",
      method: "POST",
      path: "/deploys/{deploy_id}/cancel",
      sideEffect: "write_update",
      resourceType: "deploy",
      resource: "deploy_id",
      args: [{ key: "deploy_id", in: "path", required: true, description: "The deploy id." }],
    },
  ],
};
