import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.klaviyo.com/en/reference/api_overview -- private keys are sent as
 * `Authorization: Klaviyo-API-Key <key>` with a dated `revision` header.
 */
export const klaviyo: RestConnectorSpec = {
  id: "klaviyo",
  name: "Klaviyo",
  description: "List lists and metrics, list the profiles in one list, and read one profile. Read-only.",
  category: "Marketing & email",
  docsUrl: "https://developers.klaviyo.com/en/reference/api_overview",
  host: "a.klaviyo.com",
  basePath: "/api",
  credential: {
    label: "Private API key",
    help: "Klaviyo → Settings → API keys → Create Private API Key with read access to Lists, Profiles and Metrics.",
    placeholder: "pk_…",
  },
  auth: { headers: { Authorization: "Klaviyo-API-Key {key}" } },
  headers: { revision: "2026-10-15", Accept: "application/vnd.api+json" },
  verify: { method: "GET", path: "/lists" },
  operations: [
    {
      slug: "list_lists",
      summary: "Lists the account's lists.",
      method: "GET",
      path: "/lists",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_list_profiles",
      summary: "Lists the profiles in one list (first page).",
      method: "GET",
      path: "/lists/{list_id}/profiles",
      sideEffect: "read",
      resourceType: "list",
      resource: "list_id",
      dataSensitivity: "confidential",
      args: [{ key: "list_id", in: "path", required: true, description: "The list id." }],
    },
    {
      slug: "get_profile",
      summary: "Returns one profile's email, name and properties.",
      method: "GET",
      path: "/profiles/{profile_id}",
      sideEffect: "read",
      resourceType: "profile",
      resource: "profile_id",
      dataSensitivity: "confidential",
      args: [{ key: "profile_id", in: "path", required: true, description: "The profile id." }],
    },
    {
      slug: "list_metrics",
      summary: "Lists the account's metrics (event types such as Placed Order).",
      method: "GET",
      path: "/metrics",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
  ],
};
