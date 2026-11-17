import type { RestConnectorSpec } from "../spec";

/**
 * https://amplitude.com/docs/apis/analytics/dashboard-rest -- basic auth with the project's API key as username and
 * secret key as password (US data center). Read-only.
 */
export const amplitude: RestConnectorSpec = {
  id: "amplitude",
  name: "Amplitude",
  description: "List events, count active users or one event over a date range, and read a saved chart.",
  category: "Analytics",
  docsUrl: "https://amplitude.com/docs/apis/analytics/dashboard-rest",
  host: "amplitude.com",
  credential: {
    label: "Secret key",
    help: "Amplitude → Settings → Projects → your project → General. Paste the secret key here and the API key below.",
  },
  configFields: [
    {
      key: "api_key",
      label: "API key",
      help: "The project's API key, shown next to the secret key.",
      pattern: "^[0-9a-fA-F]{32}$",
    },
  ],
  auth: { basic: { username: "{config.api_key}", password: "{key}" } },
  verify: { method: "GET", path: "/api/2/events/list" },
  operations: [
    {
      slug: "list_events",
      summary: "Lists the project's visible events with this week's totals.",
      method: "GET",
      path: "/api/2/events/list",
      sideEffect: "read",
      resourceType: "project",
      args: [],
    },
    {
      slug: "active_users",
      summary: "Counts active (or new) users per day between two dates.",
      method: "GET",
      path: "/api/2/users",
      sideEffect: "read",
      resourceType: "project",
      args: [
        { key: "start", in: "query", required: true, description: "Start date, YYYYMMDD." },
        { key: "end", in: "query", required: true, description: "End date, YYYYMMDD." },
        { key: "m", in: "query", required: false, description: "active (default) or new." },
      ],
    },
    {
      slug: "event_segmentation",
      summary: "Counts one event per day between two dates.",
      method: "GET",
      path: "/api/2/events/segmentation",
      sideEffect: "read",
      resourceType: "project",
      args: [
        {
          key: "e",
          in: "query",
          required: true,
          description: 'Event as JSON, e.g. {"event_type":"Sign Up"}.',
        },
        { key: "start", in: "query", required: true, description: "Start date, YYYYMMDD." },
        { key: "end", in: "query", required: true, description: "End date, YYYYMMDD." },
      ],
    },
    {
      slug: "get_chart",
      summary: "Returns the results of one saved chart.",
      method: "GET",
      path: "/api/3/chart/{chart_id}/query",
      sideEffect: "read",
      resourceType: "chart",
      resource: "chart_id",
      args: [{ key: "chart_id", in: "path", required: true, description: "The chart id (from its URL)." }],
    },
  ],
};
