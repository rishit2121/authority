import type { RestConnectorSpec } from "../spec";

/** https://developers.smartsheet.com/api/smartsheet/introduction -- API access tokens are sent as `Authorization: Bearer <token>` (US region). */
export const smartsheet: RestConnectorSpec = {
  id: "smartsheet",
  name: "Smartsheet",
  description: "List and read sheets, and start a comment discussion on a row.",
  category: "Project management",
  docsUrl: "https://developers.smartsheet.com/api/smartsheet/introduction",
  host: "api.smartsheet.com",
  basePath: "/2.0",
  credential: {
    label: "API access token",
    help: "Smartsheet → Account → Personal settings → API access → Generate new access token. US-region accounts (api.smartsheet.com).",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/users/me" },
  operations: [
    {
      slug: "list_sheets",
      summary: "Lists the sheets the user can access.",
      method: "GET",
      path: "/sheets",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_sheet",
      summary: "Returns one sheet's columns and rows.",
      method: "GET",
      path: "/sheets/{sheet_id}",
      sideEffect: "read",
      resourceType: "sheet",
      resource: "sheet_id",
      args: [{ key: "sheet_id", in: "path", required: true, description: "The sheet's numeric id." }],
    },
    {
      slug: "add_row_comment",
      summary: "Starts one discussion with a comment on a row.",
      method: "POST",
      path: "/sheets/{sheet_id}/rows/{row_id}/discussions",
      sideEffect: "write_create",
      resourceType: "row",
      resource: "row_id",
      args: [
        { key: "sheet_id", in: "path", required: true, description: "The sheet's numeric id." },
        { key: "row_id", in: "path", required: true, description: "The row's numeric id." },
        {
          key: "text",
          in: "body",
          target: "comment.text",
          required: true,
          freeText: true,
          description: "Comment text.",
        },
      ],
    },
  ],
};
