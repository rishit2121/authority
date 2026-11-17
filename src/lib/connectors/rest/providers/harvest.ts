import type { RestConnectorSpec } from "../spec";

/**
 * https://help.getharvest.com/api-v2/ -- personal access tokens are sent as `Authorization: Bearer <token>` together
 * with the `Harvest-Account-Id` header and an identifying `User-Agent`.
 */
export const harvest: RestConnectorSpec = {
  id: "harvest",
  name: "Harvest",
  description: "List projects, task assignments and time entries, and log a time entry.",
  category: "Productivity",
  docsUrl: "https://help.getharvest.com/api-v2/",
  host: "api.harvestapp.com",
  basePath: "/v2",
  credential: {
    label: "Personal access token",
    help: "id.getharvest.com/developers → Create new personal access token. Copy the Account ID shown with it below.",
  },
  configFields: [
    {
      key: "account_id",
      label: "Harvest account ID",
      placeholder: "123456",
      help: "Shown next to the token on the Developers page.",
      pattern: "^[0-9]{1,12}$",
    },
  ],
  auth: { headers: { Authorization: "Bearer {key}", "Harvest-Account-Id": "{config.account_id}" } },
  headers: { "User-Agent": "Authority (https://github.com/rishit2121/authority)" },
  verify: { method: "GET", path: "/users/me" },
  operations: [
    {
      slug: "list_projects",
      summary: "Lists the account's active projects.",
      method: "GET",
      path: "/projects",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [],
      fixedQuery: { is_active: "true" },
    },
    {
      slug: "list_my_assignments",
      summary: "Lists the projects and tasks the current user can log time against (project and task ids).",
      method: "GET",
      path: "/users/me/project_assignments",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_time_entries",
      summary: "Lists time entries, optionally for one project and a date range.",
      method: "GET",
      path: "/time_entries",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "project_id",
          in: "query",
          type: "number",
          required: false,
          description: "Only entries for this project.",
        },
        {
          key: "from",
          in: "query",
          required: false,
          description: "Only entries spent on or after this date (YYYY-MM-DD).",
        },
        {
          key: "to",
          in: "query",
          required: false,
          description: "Only entries spent on or before this date (YYYY-MM-DD).",
        },
      ],
    },
    {
      slug: "create_time_entry",
      summary: "Logs one time entry (by duration) for the current user; billable time feeds client invoices.",
      method: "POST",
      path: "/time_entries",
      sideEffect: "write_create",
      resourceType: "project",
      resource: "project_id",
      financialImpact: true,
      args: [
        { key: "project_id", in: "body", type: "number", required: true, description: "The project's id." },
        {
          key: "task_id",
          in: "body",
          type: "number",
          required: true,
          description: "The task's id (assigned to the project).",
        },
        { key: "spent_date", in: "body", required: true, description: "Date worked (YYYY-MM-DD)." },
        { key: "hours", in: "body", type: "number", required: false, description: "Hours worked, e.g. 1.5." },
        { key: "notes", in: "body", required: false, freeText: true, description: "Notes for the entry." },
      ],
    },
  ],
};
