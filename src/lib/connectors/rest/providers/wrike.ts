import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.wrike.com/ -- permanent access tokens are sent as `Authorization: Bearer <token>` against the
 * account's data-center host (www, app-eu or app-us2 .wrike.com).
 */
export const wrike: RestConnectorSpec = {
  id: "wrike",
  name: "Wrike",
  description: "List and read tasks in a folder, create a task, and comment on one.",
  category: "Project management",
  docsUrl: "https://developers.wrike.com/docs/",
  host: "{config.region}.wrike.com",
  basePath: "/api/v4",
  credential: {
    label: "Permanent access token",
    help: "Wrike → Apps & Integrations → API → create an app → Permanent access token → Create token.",
  },
  configFields: [
    {
      key: "region",
      label: "Wrike host",
      placeholder: "www (www.wrike.com), app-eu or app-us2",
      help: "The first part of the address you use to open Wrike in a browser.",
      pattern: "^(www|app-eu|app-us2)$",
    },
  ],
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/contacts?me=true" },
  operations: [
    {
      slug: "list_folder_tasks",
      summary: "Lists the tasks in one folder or project.",
      method: "GET",
      path: "/folders/{folder_id}/tasks",
      sideEffect: "read",
      resourceType: "folder",
      resource: "folder_id",
      args: [{ key: "folder_id", in: "path", required: true, description: "The folder's or project's id." }],
    },
    {
      slug: "get_task",
      summary: "Returns one task's title, description, status, dates and assignees.",
      method: "GET",
      path: "/tasks/{task_id}",
      sideEffect: "read",
      resourceType: "task",
      resource: "task_id",
      args: [{ key: "task_id", in: "path", required: true, description: "The task's id." }],
    },
    {
      slug: "create_task",
      summary: "Creates one task in a folder or project.",
      method: "POST",
      path: "/folders/{folder_id}/tasks",
      sideEffect: "write_create",
      resourceType: "folder",
      resource: "folder_id",
      args: [
        { key: "folder_id", in: "path", required: true, description: "The folder's or project's id." },
        { key: "title", in: "query", required: true, freeText: true, description: "Task title." },
        {
          key: "description",
          in: "query",
          required: false,
          freeText: true,
          description: "Task description.",
        },
      ],
    },
    {
      slug: "add_comment",
      summary: "Adds one plain-text comment to a task.",
      method: "POST",
      path: "/tasks/{task_id}/comments",
      sideEffect: "write_create",
      resourceType: "task",
      resource: "task_id",
      args: [
        { key: "task_id", in: "path", required: true, description: "The task's id." },
        { key: "text", in: "query", required: true, freeText: true, description: "Comment text." },
      ],
      fixedQuery: { plainText: "true" },
    },
  ],
};
