import type { RestConnectorSpec } from "../spec";

/** https://developers.figma.com/docs/rest-api/ -- personal access tokens are sent in the `X-Figma-Token` header. */
export const figma: RestConnectorSpec = {
  id: "figma",
  name: "Figma",
  description: "Read a file's metadata and page structure, list its comments, and add a comment.",
  category: "Content & design",
  docsUrl: "https://developers.figma.com/docs/rest-api/",
  iconSlug: "figma",
  host: "api.figma.com",
  credential: {
    label: "Personal access token",
    help: "Figma → Settings → Security → Personal access tokens → Generate new token (file content, comments and current user scopes).",
    placeholder: "figd_…",
  },
  auth: { headers: { "X-Figma-Token": "{key}" } },
  verify: { method: "GET", path: "/v1/me" },
  operations: [
    {
      slug: "get_file_metadata",
      summary: "Returns one file's name, editor type, last-modified time and thumbnail.",
      method: "GET",
      path: "/v1/files/{file_key}/meta",
      sideEffect: "read",
      resourceType: "file",
      resource: "file_key",
      args: [
        { key: "file_key", in: "path", required: true, description: "The file key from the file's URL." },
      ],
    },
    {
      slug: "get_file",
      summary: "Returns one file's document tree down to its top-level frames.",
      method: "GET",
      path: "/v1/files/{file_key}",
      sideEffect: "read",
      resourceType: "file",
      resource: "file_key",
      args: [
        { key: "file_key", in: "path", required: true, description: "The file key from the file's URL." },
      ],
      fixedQuery: { depth: "2" },
    },
    {
      slug: "list_comments",
      summary: "Lists the comments on one file.",
      method: "GET",
      path: "/v1/files/{file_key}/comments",
      sideEffect: "read",
      resourceType: "file",
      resource: "file_key",
      args: [
        { key: "file_key", in: "path", required: true, description: "The file key from the file's URL." },
      ],
      fixedQuery: { as_md: "true" },
    },
    {
      slug: "add_comment",
      summary: "Posts one comment on a file, or a reply to an existing root comment.",
      method: "POST",
      path: "/v1/files/{file_key}/comments",
      sideEffect: "write_create",
      resourceType: "file",
      resource: "file_key",
      args: [
        { key: "file_key", in: "path", required: true, description: "The file key from the file's URL." },
        { key: "message", in: "body", required: true, freeText: true, description: "Comment text." },
        { key: "comment_id", in: "body", required: false, description: "Root comment to reply to." },
      ],
    },
  ],
};
