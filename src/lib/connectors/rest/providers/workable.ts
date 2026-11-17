import type { RestConnectorSpec } from "../spec";

/**
 * https://workable.readme.io/reference/generate-an-access-token -- API access tokens are sent as
 * `Authorization: Bearer <token>` against the account's own `{subdomain}.workable.com/spi/v3`.
 */
export const workable: RestConnectorSpec = {
  id: "workable",
  name: "Workable",
  description: "List jobs and candidates, read a candidate, and comment on a candidate's timeline.",
  category: "HR & recruiting",
  docsUrl: "https://workable.readme.io/reference/generate-an-access-token",
  host: "{config.subdomain}.workable.com",
  basePath: "/spi/v3",
  credential: {
    label: "API access token",
    help: "Workable → Settings → Integrations → Apps → API Access Token → Generate, with r_jobs, r_candidates and (for comments) w_comments.",
  },
  configFields: [
    {
      key: "subdomain",
      label: "Workable subdomain",
      placeholder: "acme (for acme.workable.com)",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
  ],
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/jobs?limit=1" },
  operations: [
    {
      slug: "list_jobs",
      summary: "Lists jobs, optionally by state.",
      method: "GET",
      path: "/jobs",
      sideEffect: "read",
      resourceType: "account",
      args: [
        { key: "state", in: "query", required: false, description: "draft, published, archived or closed." },
        { key: "limit", in: "query", type: "number", required: false, description: "Page size." },
      ],
    },
    {
      slug: "list_candidates",
      summary: "Lists candidates, optionally for one job or stage.",
      method: "GET",
      path: "/candidates",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "shortcode",
          in: "query",
          required: false,
          description: "Only candidates for this job shortcode.",
        },
        { key: "stage", in: "query", required: false, description: "Only candidates in this stage slug." },
        { key: "limit", in: "query", type: "number", required: false, description: "Page size." },
        {
          key: "since_id",
          in: "query",
          required: false,
          description: "Only candidates with an id at or after this one.",
        },
      ],
    },
    {
      slug: "get_candidate",
      summary: "Returns one candidate's profile, stage and job.",
      method: "GET",
      path: "/candidates/{candidate_id}",
      sideEffect: "read",
      resourceType: "candidate",
      resource: "candidate_id",
      dataSensitivity: "confidential",
      args: [{ key: "candidate_id", in: "path", required: true, description: "The candidate id." }],
    },
    {
      slug: "add_comment",
      summary: "Adds one comment to a candidate's timeline; changes nothing else.",
      method: "POST",
      path: "/candidates/{candidate_id}/comments",
      sideEffect: "write_create",
      resourceType: "candidate",
      resource: "candidate_id",
      dataSensitivity: "confidential",
      args: [
        { key: "candidate_id", in: "path", required: true, description: "The candidate id." },
        {
          key: "member_id",
          in: "body",
          required: true,
          description: "The Workable member id the comment is posted as.",
        },
        {
          key: "body",
          in: "body",
          target: "comment.body",
          required: true,
          freeText: true,
          description: "The comment text.",
        },
      ],
    },
  ],
};
