import type { RestConnectorSpec } from "../spec";

/** https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps -- `xi-api-key: <API key>` header. */
export const elevenlabs: RestConnectorSpec = {
  id: "elevenlabs",
  name: "ElevenLabs",
  description:
    "List voices and models, check credit usage, and synthesize one clip of speech (eleven_flash_v2_5).",
  category: "AI & ML",
  docsUrl: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps",
  iconSlug: "elevenlabs",
  host: "api.elevenlabs.io",
  credential: {
    label: "API key",
    help: "elevenlabs.io → Developers → API Keys → Create key. If you restrict it, allow Text to Speech plus read access to Voices, Models and User.",
    placeholder: "sk_…",
  },
  auth: { headers: { "xi-api-key": "{key}" } },
  verify: { method: "GET", path: "/v1/user/subscription" },
  operations: [
    {
      slug: "list_voices",
      summary: "Lists the voices available to the account, optionally matching a search term.",
      method: "GET",
      path: "/v2/voices",
      sideEffect: "read",
      resourceType: "account",
      args: [
        {
          key: "search",
          in: "query",
          required: false,
          description: "Matches voice name, description, labels or category.",
        },
        {
          key: "page_size",
          in: "query",
          type: "number",
          required: false,
          description: "Page size (at most 100).",
        },
      ],
    },
    {
      slug: "list_models",
      summary: "Lists the available speech models.",
      method: "GET",
      path: "/v1/models",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_subscription",
      summary: "Returns the account's plan and character credit usage.",
      method: "GET",
      path: "/v1/user/subscription",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "text_to_speech",
      summary:
        "Synthesizes one clip of speech with eleven_flash_v2_5; returns base64 MP3 plus character timings.",
      method: "POST",
      path: "/v1/text-to-speech/{voice_id}/with-timestamps",
      sideEffect: "write_create",
      resourceType: "voice",
      resource: "voice_id",
      fixedQuery: { output_format: "mp3_22050_32" },
      fixedBody: { model_id: "eleven_flash_v2_5" },
      args: [
        { key: "voice_id", in: "path", required: true, description: "The voice id." },
        { key: "text", in: "body", required: true, freeText: true, description: "The text to speak." },
      ],
    },
  ],
};
