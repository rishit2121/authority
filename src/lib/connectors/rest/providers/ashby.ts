import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.ashbyhq.com/reference/introduction -- RPC-style POST endpoints with JSON bodies; HTTP basic auth
 * with the API key as the username and a blank password.
 */
export const ashby: RestConnectorSpec = {
  id: "ashby",
  name: "Ashby",
  description: "List jobs and candidates, read a candidate, and add a note to a candidate.",
  category: "HR & recruiting",
  docsUrl: "https://developers.ashbyhq.com/reference/introduction",
  host: "api.ashbyhq.com",
  credential: {
    label: "API key",
    help: "Ashby → Admin → Integrations → API Keys → create a key with candidatesRead, jobsRead and (for notes) candidatesWrite.",
  },
  auth: { basic: { username: "{key}", password: "" } },
  verify: { method: "POST", path: "/apiKey.info", body: "{}" },
  operations: [
    {
      slug: "list_jobs",
      summary: "Lists jobs, one page at a time.",
      method: "POST",
      path: "/job.list",
      sideEffect: "read",
      resourceType: "account",
      fixedBody: {},
      args: [
        {
          key: "limit",
          in: "body",
          type: "number",
          required: false,
          description: "Page size (at most 100).",
        },
        { key: "cursor", in: "body", required: false, description: "nextCursor from a previous response." },
      ],
    },
    {
      slug: "list_candidates",
      summary: "Lists candidates, one page at a time.",
      method: "POST",
      path: "/candidate.list",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      fixedBody: {},
      args: [
        {
          key: "limit",
          in: "body",
          type: "number",
          required: false,
          description: "Page size (at most 100).",
        },
        { key: "cursor", in: "body", required: false, description: "nextCursor from a previous response." },
      ],
    },
    {
      slug: "get_candidate",
      summary: "Returns one candidate's profile and applications.",
      method: "POST",
      path: "/candidate.info",
      sideEffect: "read",
      resourceType: "candidate",
      resource: "candidate_id",
      dataSensitivity: "confidential",
      args: [
        {
          key: "candidate_id",
          in: "body",
          target: "id",
          required: true,
          description: "The candidate id (UUID).",
        },
      ],
    },
    {
      slug: "add_note",
      summary: "Adds one note to a candidate without notifying subscribers; changes nothing else.",
      method: "POST",
      path: "/candidate.createNote",
      sideEffect: "write_create",
      resourceType: "candidate",
      resource: "candidate_id",
      dataSensitivity: "confidential",
      fixedBody: { sendNotifications: false },
      args: [
        {
          key: "candidate_id",
          in: "body",
          target: "candidateId",
          required: true,
          description: "The candidate id (UUID).",
        },
        {
          key: "note",
          in: "body",
          required: true,
          freeText: true,
          description: "The note text (plain text).",
        },
      ],
    },
  ],
};
