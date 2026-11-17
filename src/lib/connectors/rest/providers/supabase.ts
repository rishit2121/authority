import type { RestConnectorSpec } from "../spec";

/**
 * https://supabase.com/docs/reference/api/introduction -- Management API personal access tokens are sent as
 * `Authorization: Bearer <token>`. Read-only; no endpoint here returns project API keys or secrets.
 */
export const supabase: RestConnectorSpec = {
  id: "supabase",
  name: "Supabase",
  description: "List and read projects, check a project's service health, and list its Edge Functions.",
  category: "Cloud & infrastructure",
  docsUrl: "https://supabase.com/docs/reference/api/introduction",
  iconSlug: "supabase",
  host: "api.supabase.com",
  basePath: "/v1",
  credential: {
    label: "Personal access token",
    help: "Supabase Dashboard → Account → Access Tokens → Generate new token.",
    placeholder: "sbp_…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/projects" },
  operations: [
    {
      slug: "list_projects",
      summary: "Lists the projects the account can access.",
      method: "GET",
      path: "/projects",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_project",
      summary: "Returns one project's name, region, status and database host.",
      method: "GET",
      path: "/projects/{ref}",
      sideEffect: "read",
      resourceType: "project",
      resource: "ref",
      args: [
        { key: "ref", in: "path", required: true, description: "The project ref (20 lowercase letters)." },
      ],
    },
    {
      slug: "get_project_health",
      summary: "Returns the health of one project's auth, database, realtime, REST and storage services.",
      method: "GET",
      path: "/projects/{ref}/health",
      sideEffect: "read",
      resourceType: "project",
      resource: "ref",
      args: [
        { key: "ref", in: "path", required: true, description: "The project ref (20 lowercase letters)." },
      ],
      fixedQuery: { services: "auth,db,realtime,rest,storage" },
    },
    {
      slug: "list_functions",
      summary: "Lists one project's Edge Functions and their status.",
      method: "GET",
      path: "/projects/{ref}/functions",
      sideEffect: "read",
      resourceType: "project",
      resource: "ref",
      args: [
        { key: "ref", in: "path", required: true, description: "The project ref (20 lowercase letters)." },
      ],
    },
  ],
};
