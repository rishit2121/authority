import type { RestConnectorSpec } from "../spec";

/**
 * https://cloudinary.com/documentation/admin_api -- HTTP basic auth with the API key as the username and the API secret
 * as the password, against `api.cloudinary.com/v1_1/<cloud_name>`.
 */
export const cloudinary: RestConnectorSpec = {
  id: "cloudinary",
  name: "Cloudinary",
  description: "Read-only: list assets, read one asset's details, and report account usage.",
  category: "Content & design",
  docsUrl: "https://cloudinary.com/documentation/admin_api",
  iconSlug: "cloudinary",
  host: "api.cloudinary.com",
  basePath: "/v1_1/{config.cloud_name}",
  credential: {
    label: "API secret",
    help: "Cloudinary Console → Settings → API Keys. Paste the API secret here and the matching API key below.",
  },
  configFields: [
    {
      key: "cloud_name",
      label: "Cloud name",
      placeholder: "demo",
      help: "Shown on the Cloudinary Console dashboard.",
      pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$",
    },
    {
      key: "api_key",
      label: "API key",
      placeholder: "123456789012345",
      help: "The numeric API key paired with the secret.",
      pattern: "^[0-9]{6,24}$",
    },
  ],
  auth: { basic: { username: "{config.api_key}", password: "{key}" } },
  verify: { method: "GET", path: "/ping" },
  operations: [
    {
      slug: "list_assets",
      summary: "Lists uploaded assets of one resource type, newest first.",
      method: "GET",
      path: "/resources/{resource_type}",
      sideEffect: "read",
      resourceType: "account",
      args: [
        { key: "resource_type", in: "path", required: true, description: "image, video or raw." },
        {
          key: "prefix",
          in: "query",
          required: false,
          description: "Only public IDs starting with this prefix.",
        },
        {
          key: "max_results",
          in: "query",
          type: "number",
          required: false,
          description: "Page size (at most 500).",
        },
        { key: "next_cursor", in: "query", required: false, description: "Cursor from a previous response." },
      ],
    },
    {
      slug: "get_asset",
      summary: "Returns one asset's details by its asset id.",
      method: "GET",
      path: "/resources/{asset_id}",
      sideEffect: "read",
      resourceType: "asset",
      resource: "asset_id",
      args: [{ key: "asset_id", in: "path", required: true, description: "The asset's immutable asset_id." }],
    },
    {
      slug: "get_usage",
      summary: "Reports storage, bandwidth, transformations and credit usage.",
      method: "GET",
      path: "/usage",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
  ],
};
