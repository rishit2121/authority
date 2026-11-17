import type { RestConnectorSpec } from "../spec";

/** https://developer.clickup.com/reference -- personal API tokens are sent as the bare header `Authorization: pk_…`. */
export const clickup: RestConnectorSpec = {
  id: "clickup",
  name: "ClickUp",
  description: "List and read tasks in a list, create a task, and comment on one.",
  category: "Project management",
  docsUrl: "https://developer.clickup.com/reference",
  iconSlug: "clickup",
  host: "api.clickup.com",
  basePath: "/api/v2",
  credential: {
    label: "Personal API token",
    help: "ClickUp → Settings → Apps → API Token → Generate.",
    placeholder: "pk_…",
  },
  auth: { headers: { Authorization: "{key}" } },
  verify: { method: "GET", path: "/user" },
  operations: [
    {
      slug: "list_tasks",
      summary: "Lists the open tasks in one list (100 per page).",
      method: "GET",
      path: "/list/{list_id}/task",
      sideEffect: "read",
      resourceType: "list",
      resource: "list_id",
      args: [
        { key: "list_id", in: "path", required: true, description: "The list's id." },
        {
          key: "page",
          in: "query",
          type: "number",
          required: false,
          description: "Page number, starting at 0.",
        },
      ],
    },
    {
      slug: "get_task",
      summary: "Returns one task's name, description, status and assignees.",
      method: "GET",
      path: "/task/{task_id}",
      sideEffect: "read",
      resourceType: "task",
      resource: "task_id",
      args: [{ key: "task_id", in: "path", required: true, description: "The task's id." }],
    },
    {
      slug: "create_task",
      summary: "Creates one task in a list with a name and optional description.",
      method: "POST",
      path: "/list/{list_id}/task",
      sideEffect: "write_create",
      resourceType: "list",
      resource: "list_id",
      args: [
        { key: "list_id", in: "path", required: true, description: "The list's id." },
        { key: "name", in: "body", required: true, freeText: true, description: "Task name." },
        { key: "description", in: "body", required: false, freeText: true, description: "Task description." },
      ],
    },
    {
      slug: "add_comment",
      summary: "Adds one comment to a task without notifying everyone.",
      method: "POST",
      path: "/task/{task_id}/comment",
      sideEffect: "write_create",
      resourceType: "task",
      resource: "task_id",
      args: [
        { key: "task_id", in: "path", required: true, description: "The task's id." },
        { key: "comment_text", in: "body", required: true, freeText: true, description: "Comment text." },
      ],
      fixedBody: { notify_all: false },
    },
  ],
};
