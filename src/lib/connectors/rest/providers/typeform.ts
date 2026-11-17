import type { RestConnectorSpec } from "../spec";

/** https://www.typeform.com/developers/ -- personal access tokens are sent as `Authorization: Bearer <token>` (US data center). */
export const typeform: RestConnectorSpec = {
  id: "typeform",
  name: "Typeform",
  description: "List and read forms, and read a form's submitted responses.",
  category: "Productivity",
  docsUrl: "https://www.typeform.com/developers/",
  iconSlug: "typeform",
  host: "api.typeform.com",
  credential: {
    label: "Personal access token",
    help: "Typeform → Settings → Personal tokens → Generate a new token (forms:read, responses:read, accounts:read).",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/me" },
  operations: [
    {
      slug: "list_forms",
      summary: "Lists the account's forms, optionally matching a search term.",
      method: "GET",
      path: "/forms",
      sideEffect: "read",
      resourceType: "account",
      args: [{ key: "search", in: "query", required: false, description: "Search term forms must contain." }],
    },
    {
      slug: "get_form",
      summary: "Returns one form's title, fields and settings.",
      method: "GET",
      path: "/forms/{form_id}",
      sideEffect: "read",
      resourceType: "form",
      resource: "form_id",
      args: [{ key: "form_id", in: "path", required: true, description: "The form's id (from its URL)." }],
    },
    {
      slug: "list_responses",
      summary: "Lists submitted responses to one form.",
      method: "GET",
      path: "/forms/{form_id}/responses",
      sideEffect: "read",
      resourceType: "form",
      resource: "form_id",
      dataSensitivity: "confidential",
      args: [
        { key: "form_id", in: "path", required: true, description: "The form's id (from its URL)." },
        {
          key: "page_size",
          in: "query",
          type: "number",
          required: false,
          description: "Responses per page.",
        },
        {
          key: "since",
          in: "query",
          required: false,
          description: "Only responses after this time (ISO 8601 or Unix seconds).",
        },
        {
          key: "until",
          in: "query",
          required: false,
          description: "Only responses before this time (ISO 8601 or Unix seconds).",
        },
      ],
    },
  ],
};
