import type { RestConnectorSpec } from "../spec";

/** https://developers.miro.com/reference/overview -- an app's access token is sent as `Authorization: Bearer <token>`. */
export const miro: RestConnectorSpec = {
  id: "miro",
  name: "Miro",
  description: "List boards and the items on a board, and add a sticky note to a board.",
  category: "Content & design",
  docsUrl: "https://developers.miro.com/reference/overview",
  iconSlug: "miro",
  host: "api.miro.com",
  credential: {
    label: "Access token",
    help: "Miro → Settings → Your apps → create an app (boards:read, boards:write) → Install app and get OAuth token, then copy the token.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/v1/oauth-token" },
  operations: [
    {
      slug: "list_boards",
      summary: "Lists the boards the token can access, optionally matching a search term.",
      method: "GET",
      path: "/v2/boards",
      sideEffect: "read",
      resourceType: "team",
      args: [
        { key: "query", in: "query", required: false, description: "Search term board names must match." },
      ],
    },
    {
      slug: "list_board_items",
      summary: "Lists items on one board, optionally of one type (e.g. sticky_note).",
      method: "GET",
      path: "/v2/boards/{board_id}/items",
      sideEffect: "read",
      resourceType: "board",
      resource: "board_id",
      args: [
        { key: "board_id", in: "path", required: true, description: "The board's id." },
        {
          key: "type",
          in: "query",
          required: false,
          description: "Item type filter, e.g. sticky_note, card, text.",
        },
      ],
    },
    {
      slug: "create_sticky_note",
      summary: "Adds one sticky note to a board.",
      method: "POST",
      path: "/v2/boards/{board_id}/sticky_notes",
      sideEffect: "write_create",
      resourceType: "board",
      resource: "board_id",
      args: [
        { key: "board_id", in: "path", required: true, description: "The board's id." },
        {
          key: "content",
          in: "body",
          target: "data.content",
          required: true,
          freeText: true,
          description: "Sticky note text.",
        },
      ],
    },
  ],
};
