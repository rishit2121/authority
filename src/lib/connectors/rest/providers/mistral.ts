import type { RestConnectorSpec } from "../spec";

/** https://docs.mistral.ai/openapi.yaml -- API keys are sent as `Authorization: Bearer <key>`. */
export const mistral: RestConnectorSpec = {
  id: "mistral",
  name: "Mistral AI",
  description:
    "List available models and generate one text response with a pinned model (mistral-small-2603).",
  category: "AI & ML",
  iconSlug: "mistralai",
  docsUrl: "https://docs.mistral.ai/openapi.yaml",
  host: "api.mistral.ai",
  basePath: "/v1",
  credential: {
    label: "API key",
    help: "Mistral AI Studio → API keys → Create new key.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/models" },
  operations: [
    {
      slug: "list_models",
      summary: "Lists the models the key can use.",
      method: "GET",
      path: "/models",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "create_response",
      summary:
        "Generates one text response from mistral-small-2603 (at most 1024 output tokens, not stored).",
      method: "POST",
      path: "/responses",
      sideEffect: "write_create",
      resourceType: "account",
      fixedBody: { model: "mistral-small-2603", max_output_tokens: 1024, store: false },
      args: [
        { key: "input", in: "body", required: true, freeText: true, description: "The prompt." },
        {
          key: "instructions",
          in: "body",
          required: false,
          freeText: true,
          description: "Optional system instructions.",
        },
      ],
    },
  ],
};
