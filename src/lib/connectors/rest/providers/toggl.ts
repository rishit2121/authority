import type { RestConnectorSpec } from "../spec";

/** https://engineering.toggl.com/docs/ -- API tokens use basic auth with the token as username and `api_token` as password. */
export const toggl: RestConnectorSpec = {
  id: "toggl",
  name: "Toggl Track",
  description: "List time entries and projects, see the running timer, and stop it.",
  category: "Productivity",
  docsUrl: "https://engineering.toggl.com/docs/track/api/time_entries/",
  iconSlug: "toggltrack",
  host: "api.track.toggl.com",
  basePath: "/api/v9",
  credential: {
    label: "API token",
    help: "Toggl Track → Profile settings → API Token (at the bottom of the page).",
  },
  auth: { basic: { username: "{key}", password: "api_token" } },
  verify: { method: "GET", path: "/me" },
  operations: [
    {
      slug: "list_time_entries",
      summary: "Lists the current user's latest time entries, optionally within a date range.",
      method: "GET",
      path: "/me/time_entries",
      sideEffect: "read",
      resourceType: "account",
      args: [
        {
          key: "start_date",
          in: "query",
          required: false,
          description: "From this date (YYYY-MM-DD or RFC 3339); use with end_date.",
        },
        {
          key: "end_date",
          in: "query",
          required: false,
          description: "Until this date (YYYY-MM-DD or RFC 3339); use with start_date.",
        },
      ],
    },
    {
      slug: "get_current_time_entry",
      summary: "Returns the current user's running time entry, if any.",
      method: "GET",
      path: "/me/time_entries/current",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_projects",
      summary: "Lists the projects in one workspace.",
      method: "GET",
      path: "/workspaces/{workspace_id}/projects",
      sideEffect: "read",
      resourceType: "workspace",
      resource: "workspace_id",
      args: [
        {
          key: "workspace_id",
          in: "path",
          type: "number",
          required: true,
          description: "The workspace's numeric id.",
        },
      ],
    },
    {
      slug: "stop_time_entry",
      summary: "Stops one running time entry; changes nothing else.",
      method: "PATCH",
      path: "/workspaces/{workspace_id}/time_entries/{time_entry_id}/stop",
      sideEffect: "write_update",
      resourceType: "time_entry",
      resource: "time_entry_id",
      args: [
        {
          key: "workspace_id",
          in: "path",
          type: "number",
          required: true,
          description: "The workspace's numeric id.",
        },
        {
          key: "time_entry_id",
          in: "path",
          type: "number",
          required: true,
          description: "The running time entry's id.",
        },
      ],
    },
  ],
};
