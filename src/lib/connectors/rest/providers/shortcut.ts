import type { RestConnectorSpec } from "../spec";

/** https://developer.shortcut.com/api/rest/v3 -- API tokens are sent in the `Shortcut-Token` header. */
export const shortcut: RestConnectorSpec = {
  id: "shortcut",
  name: "Shortcut",
  description: "Search and read stories, create a story, and comment on one.",
  category: "Project management",
  docsUrl: "https://developer.shortcut.com/api/rest/v3",
  iconSlug: "shortcut",
  host: "api.app.shortcut.com",
  basePath: "/api/v3",
  credential: {
    label: "API token",
    help: "Shortcut → Settings → Account → API Tokens → Generate token.",
  },
  auth: { headers: { "Shortcut-Token": "{key}" } },
  verify: { method: "GET", path: "/member" },
  operations: [
    {
      slug: "search_stories",
      summary: "Searches stories with Shortcut search operators (e.g. 'owner:me state:started').",
      method: "GET",
      path: "/search/stories",
      sideEffect: "read",
      resourceType: "workspace",
      args: [
        {
          key: "query",
          in: "query",
          required: true,
          description: "Search query, using Shortcut search operators.",
        },
        {
          key: "page_size",
          in: "query",
          type: "number",
          required: false,
          description: "Results per page (1-250).",
        },
      ],
    },
    {
      slug: "get_story",
      summary: "Returns one story's name, description, state, owners and comments.",
      method: "GET",
      path: "/stories/{story_id}",
      sideEffect: "read",
      resourceType: "story",
      resource: "story_id",
      args: [
        {
          key: "story_id",
          in: "path",
          type: "number",
          required: true,
          description: "The story's public id.",
        },
      ],
    },
    {
      slug: "create_story",
      summary: "Creates one story with a name and optional description.",
      method: "POST",
      path: "/stories",
      sideEffect: "write_create",
      resourceType: "workspace",
      args: [
        { key: "name", in: "body", required: true, freeText: true, description: "Story name." },
        {
          key: "description",
          in: "body",
          required: false,
          freeText: true,
          description: "Story description (Markdown).",
        },
        {
          key: "workflow_state_id",
          in: "body",
          type: "number",
          required: false,
          description: "Workflow state to create it in.",
        },
        { key: "story_type", in: "body", required: false, description: "feature, bug or chore." },
      ],
    },
    {
      slug: "add_comment",
      summary: "Adds one comment to a story.",
      method: "POST",
      path: "/stories/{story_id}/comments",
      sideEffect: "write_create",
      resourceType: "story",
      resource: "story_id",
      args: [
        {
          key: "story_id",
          in: "path",
          type: "number",
          required: true,
          description: "The story's public id.",
        },
        { key: "text", in: "body", required: true, freeText: true, description: "Comment text (Markdown)." },
      ],
    },
  ],
};
