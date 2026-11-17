import type { RestConnectorSpec } from "../spec";

/** https://replicate.com/docs/reference/http -- API tokens are sent as `Authorization: Bearer <token>`. */
export const replicate: RestConnectorSpec = {
  id: "replicate",
  name: "Replicate",
  description:
    "Read the account and predictions, and start one image generation with a pinned model (flux-schnell).",
  category: "AI & ML",
  docsUrl: "https://replicate.com/docs/reference/http",
  iconSlug: "replicate",
  host: "api.replicate.com",
  basePath: "/v1",
  credential: {
    label: "API token",
    help: "replicate.com → Account settings → API tokens → Create token.",
    placeholder: "r8_…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/account" },
  operations: [
    {
      slug: "get_account",
      summary: "Returns the account the token belongs to.",
      method: "GET",
      path: "/account",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_predictions",
      summary: "Lists the account's recent predictions.",
      method: "GET",
      path: "/predictions",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_prediction",
      summary: "Returns one prediction's status, output and metrics.",
      method: "GET",
      path: "/predictions/{prediction_id}",
      sideEffect: "read",
      resourceType: "prediction",
      resource: "prediction_id",
      args: [{ key: "prediction_id", in: "path", required: true, description: "The prediction id." }],
    },
    {
      slug: "generate_image",
      summary:
        "Starts one image generation with black-forest-labs/flux-schnell; poll get_prediction for the result.",
      method: "POST",
      path: "/models/black-forest-labs/flux-schnell/predictions",
      sideEffect: "write_create",
      resourceType: "account",
      args: [
        {
          key: "prompt",
          in: "body",
          target: "input.prompt",
          required: true,
          freeText: true,
          description: "The image prompt.",
        },
      ],
    },
  ],
};
