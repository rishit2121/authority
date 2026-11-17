import type { RestConnectorSpec } from "../spec";

/**
 * https://devcenter.heroku.com/articles/platform-api-reference -- API keys are sent as `Authorization: Bearer <key>`
 * with `Accept: application/vnd.heroku+json; version=3`.
 */
export const heroku: RestConnectorSpec = {
  id: "heroku",
  name: "Heroku",
  description: "List and read apps, releases and dynos, and restart one dyno.",
  category: "Cloud & infrastructure",
  docsUrl: "https://devcenter.heroku.com/articles/platform-api-reference",
  iconSlug: "heroku",
  host: "api.heroku.com",
  credential: {
    label: "API key",
    help: "Run `heroku authorizations:create`, or copy the API key from Heroku Dashboard → Account settings.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  headers: { Accept: "application/vnd.heroku+json; version=3" },
  verify: { method: "GET", path: "/account" },
  operations: [
    {
      slug: "list_apps",
      summary: "Lists the apps the account can access.",
      method: "GET",
      path: "/apps",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_app",
      summary: "Returns one app's region, stack, owner and web URL.",
      method: "GET",
      path: "/apps/{app}",
      sideEffect: "read",
      resourceType: "app",
      resource: "app",
      args: [{ key: "app", in: "path", required: true, description: "The app's name or id." }],
    },
    {
      slug: "list_releases",
      summary: "Lists one app's releases with their version, status and description.",
      method: "GET",
      path: "/apps/{app}/releases",
      sideEffect: "read",
      resourceType: "app",
      resource: "app",
      args: [{ key: "app", in: "path", required: true, description: "The app's name or id." }],
    },
    {
      slug: "list_dynos",
      summary: "Lists one app's dynos and their state.",
      method: "GET",
      path: "/apps/{app}/dynos",
      sideEffect: "read",
      resourceType: "app",
      resource: "app",
      args: [{ key: "app", in: "path", required: true, description: "The app's name or id." }],
    },
    {
      slug: "restart_dyno",
      summary: "Restarts one dyno of an app (Heroku's documented restart is a DELETE on the dyno).",
      method: "DELETE",
      path: "/apps/{app}/dynos/{dyno}",
      sideEffect: "write_update",
      resourceType: "dyno",
      resource: "dyno",
      args: [
        { key: "app", in: "path", required: true, description: "The app's name or id." },
        { key: "dyno", in: "path", required: true, description: "The dyno's name (e.g. web.1) or id." },
      ],
    },
  ],
};
