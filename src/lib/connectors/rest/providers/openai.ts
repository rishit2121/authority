import type { RestConnectorSpec } from "../spec";

/** https://developers.openai.com/api/reference/resources/responses/methods/create -- `Authorization: Bearer <API key>`. */
export const openai: RestConnectorSpec = {
  id: "openai",
  name: "OpenAI",
  description: "List available models and generate one text response with a pinned model (gpt-6-luna).",
  category: "AI & ML",
  docsUrl: "https://developers.openai.com/api/reference/resources/responses/methods/create",
  iconSlug: "openai",
  host: "api.openai.com",
  basePath: "/v1",
  credential: {
    label: "API key",
    help: "platform.openai.com → API keys → Create new secret key (a project key restricted to Models read and Responses write is enough).",
    placeholder: "sk-…",
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
        "Generates one text response from gpt-6-luna (at most 1024 output tokens, not stored by OpenAI).",
      method: "POST",
      path: "/responses",
      sideEffect: "write_create",
      resourceType: "account",
      fixedBody: { model: "gpt-6-luna", max_output_tokens: 1024, store: false },
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
