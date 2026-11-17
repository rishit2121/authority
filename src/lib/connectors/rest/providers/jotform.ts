import type { RestConnectorSpec } from "../spec";

/** https://api.jotform.com/docs/ -- API keys are sent in the `APIKEY` header (US host api.jotform.com). */
export const jotform: RestConnectorSpec = {
  id: "jotform",
  name: "Jotform",
  description: "List forms, list a form's submissions, and read one submission.",
  category: "Productivity",
  docsUrl: "https://api.jotform.com/docs/",
  host: "api.jotform.com",
  credential: {
    label: "API key",
    help: "Jotform → Settings → API → Create new key (Read Access is enough).",
  },
  auth: { headers: { APIKEY: "{key}" } },
  verify: { method: "GET", path: "/user" },
  operations: [
    {
      slug: "list_forms",
      summary: "Lists the account's forms.",
      method: "GET",
      path: "/user/forms",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_submissions",
      summary: "Lists the submissions to one form.",
      method: "GET",
      path: "/form/{form_id}/submissions",
      sideEffect: "read",
      resourceType: "form",
      resource: "form_id",
      dataSensitivity: "confidential",
      args: [{ key: "form_id", in: "path", required: true, description: "The form's id." }],
    },
    {
      slug: "get_submission",
      summary: "Returns one submission's answers.",
      method: "GET",
      path: "/submission/{submission_id}",
      sideEffect: "read",
      resourceType: "submission",
      resource: "submission_id",
      dataSensitivity: "confidential",
      args: [{ key: "submission_id", in: "path", required: true, description: "The submission's id." }],
    },
  ],
};
