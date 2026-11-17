import type { RestConnectorSpec } from "../spec";

/** https://plausible.io/docs/stats-api -- Stats API keys are sent as `Authorization: Bearer <key>`. Read-only. */
export const plausible: RestConnectorSpec = {
  id: "plausible",
  name: "Plausible Analytics",
  description: "List your sites, read one site, and query its visitor stats over a date range.",
  category: "Analytics",
  docsUrl: "https://plausible.io/docs/stats-api",
  iconSlug: "plausibleanalytics",
  host: "plausible.io",
  basePath: "/api",
  credential: {
    label: "Stats API key",
    help: "Plausible → Account settings → API keys → New API key (Stats API). Plausible Cloud only.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/v1/sites" },
  operations: [
    {
      slug: "list_sites",
      summary: "Lists the sites the key can read.",
      method: "GET",
      path: "/v1/sites",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_site",
      summary: "Returns one site's domain and timezone.",
      method: "GET",
      path: "/v1/sites/{site_id}",
      sideEffect: "read",
      resourceType: "site",
      resource: "site_id",
      args: [
        { key: "site_id", in: "path", required: true, description: "The site's domain, e.g. example.com." },
      ],
    },
    {
      slug: "query_stats",
      summary: "Queries one site's metrics (visitors, pageviews, ...) over a date range; reads only.",
      method: "POST",
      path: "/v2/query",
      sideEffect: "read",
      resourceType: "site",
      resource: "site_id",
      args: [
        { key: "site_id", in: "body", required: true, description: "The site's domain, e.g. example.com." },
        {
          key: "metrics",
          in: "body",
          type: "stringArray",
          required: true,
          description: "Metric names, e.g. visitors, visits, pageviews, bounce_rate, visit_duration.",
        },
        {
          key: "date_range",
          in: "body",
          required: true,
          description: "A period such as day, 7d, 30d, month, 12mo or all.",
        },
        {
          key: "dimensions",
          in: "body",
          type: "stringArray",
          required: false,
          description: "Optional group-by dimensions, e.g. visit:source or time:day.",
        },
      ],
    },
  ],
};
