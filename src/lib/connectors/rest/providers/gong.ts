import type { RestConnectorSpec } from "../spec";

/**
 * https://help.gong.io/apidocs/introduction-2 -- basic auth with the Access Key as the username and the Access Key
 * Secret as the password, against the account's own API host (e.g. `us-12345.api.gong.io`).
 */
export const gong: RestConnectorSpec = {
  id: "gong",
  name: "Gong",
  description: "List and read recorded calls, fetch call transcripts, and list users. Read-only.",
  category: "CRM & sales",
  docsUrl: "https://help.gong.io/apidocs/introduction-2",
  host: "{config.host_prefix}.api.gong.io",
  basePath: "/v2",
  credential: {
    label: "Access key secret",
    help: "Admin center → Ecosystem → API → Create. Paste the Access Key Secret here and the Access Key below.",
  },
  configFields: [
    {
      key: "host_prefix",
      label: "API host prefix",
      placeholder: "us-12345 (for https://us-12345.api.gong.io)",
      help: "The first part of the base URL shown on Gong's API page.",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
    {
      key: "access_key",
      label: "Access key",
      help: "The Access Key shown next to the secret.",
      pattern: "^[A-Za-z0-9_-]{8,128}$",
    },
  ],
  auth: { basic: { username: "{config.access_key}", password: "{key}" } },
  verify: { method: "GET", path: "/users" },
  operations: [
    {
      slug: "list_calls",
      summary: "Lists calls that started in a date range.",
      method: "GET",
      path: "/calls",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "from_date_time",
          in: "query",
          target: "fromDateTime",
          required: true,
          description: "Start, ISO-8601 (e.g. 2026-01-01T00:00:00Z).",
        },
        {
          key: "to_date_time",
          in: "query",
          target: "toDateTime",
          required: true,
          description: "End, ISO-8601.",
        },
      ],
    },
    {
      slug: "get_call",
      summary: "Returns one call's metadata (title, start time, duration, link).",
      method: "GET",
      path: "/calls/{call_id}",
      sideEffect: "read",
      resourceType: "call",
      resource: "call_id",
      dataSensitivity: "confidential",
      args: [{ key: "call_id", in: "path", required: true, description: "The Gong call id." }],
    },
    {
      slug: "get_transcripts",
      summary: "Returns the transcripts of the given calls.",
      method: "POST",
      path: "/calls/transcript",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "call_ids",
          in: "body",
          target: "filter.callIds",
          type: "stringArray",
          required: true,
          description: "Gong call ids.",
        },
      ],
    },
    {
      slug: "list_users",
      summary: "Lists the company's Gong users.",
      method: "GET",
      path: "/users",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
  ],
};
