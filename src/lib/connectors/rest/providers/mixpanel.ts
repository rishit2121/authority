import type { RestConnectorSpec } from "../spec";

/**
 * https://docs.mixpanel.com/reference/query-api -- service accounts use basic auth with the service account
 * username and secret (US data residency). Read-only.
 */
export const mixpanel: RestConnectorSpec = {
  id: "mixpanel",
  name: "Mixpanel",
  description:
    "List a project's top events, count an event over a date range, and read a saved Insights report.",
  category: "Analytics",
  docsUrl: "https://docs.mixpanel.com/reference/query-api",
  iconSlug: "mixpanel",
  host: "mixpanel.com",
  basePath: "/api",
  credential: {
    label: "Service account secret",
    help: "Mixpanel → Organization Settings → Service Accounts → Add. Give it access to the project; paste the secret here and the username below.",
  },
  configFields: [
    {
      key: "username",
      label: "Service account username",
      placeholder: "name.a1b2c3.mp-service-account",
      pattern: "^[A-Za-z0-9._-]{1,128}$",
    },
  ],
  auth: { basic: { username: "{config.username}", password: "{key}" } },
  verify: { method: "GET", path: "/app/me" },
  operations: [
    {
      slug: "list_top_events",
      summary: "Lists the project's most common event names over the last 31 days.",
      method: "GET",
      path: "/query/events/names",
      sideEffect: "read",
      resourceType: "project",
      resource: "project_id",
      fixedQuery: { type: "general" },
      args: [
        {
          key: "project_id",
          in: "query",
          type: "number",
          required: true,
          description: "The Mixpanel project id.",
        },
      ],
    },
    {
      slug: "event_segmentation",
      summary: "Counts one event per day between two dates, optionally segmented by a property.",
      method: "GET",
      path: "/query/segmentation",
      sideEffect: "read",
      resourceType: "project",
      resource: "project_id",
      args: [
        {
          key: "project_id",
          in: "query",
          type: "number",
          required: true,
          description: "The Mixpanel project id.",
        },
        { key: "event", in: "query", required: true, description: "The event name." },
        { key: "from_date", in: "query", required: true, description: "Start date, yyyy-mm-dd (inclusive)." },
        { key: "to_date", in: "query", required: true, description: "End date, yyyy-mm-dd (inclusive)." },
        {
          key: "on",
          in: "query",
          required: false,
          description: 'Property expression to segment by, e.g. properties["country"].',
        },
      ],
    },
    {
      slug: "query_insights_report",
      summary: "Returns the data of one saved Insights report.",
      method: "GET",
      path: "/query/insights",
      sideEffect: "read",
      resourceType: "report",
      resource: "bookmark_id",
      args: [
        {
          key: "project_id",
          in: "query",
          type: "number",
          required: true,
          description: "The Mixpanel project id.",
        },
        {
          key: "bookmark_id",
          in: "query",
          type: "number",
          required: true,
          description: "The saved report's id (from its URL).",
        },
      ],
    },
  ],
};
