import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.monday.com/api-reference/docs/basics -- one GraphQL endpoint (`POST /v2`); personal API tokens are
 * sent as the bare header `Authorization: <token>`, with the version pinned via `API-Version`.
 */
export const monday: RestConnectorSpec = {
  id: "monday",
  name: "monday.com",
  description: "List boards and their items, read an item, create an item, and post an update on one.",
  category: "Project management",
  docsUrl: "https://developer.monday.com/api-reference/docs/basics",
  host: "api.monday.com",
  credential: {
    label: "Personal API token",
    help: "monday.com → your avatar → Developers → My access tokens → Show.",
  },
  auth: { headers: { Authorization: "{key}" } },
  headers: { "API-Version": "2026-10" },
  verify: { method: "POST", path: "/v2", body: '{"query":"query { me { id } }"}' },
  operations: [
    {
      slug: "list_boards",
      summary: "Lists up to 50 active boards (id and name).",
      method: "POST",
      path: "/v2",
      sideEffect: "read",
      resourceType: "account",
      args: [],
      fixedBody: { query: "query { boards(limit: 50, state: active) { id name } }" },
    },
    {
      slug: "list_board_items",
      summary: "Lists the first 50 items on one board with their group.",
      method: "POST",
      path: "/v2",
      sideEffect: "read",
      resourceType: "board",
      resource: "board_id",
      args: [
        {
          key: "board_id",
          in: "body",
          target: "variables.board_id",
          required: true,
          description: "The board's id.",
        },
      ],
      fixedBody: {
        query:
          "query ($board_id: ID!) { boards(ids: [$board_id]) { items_page(limit: 50) { cursor items { id name group { id title } } } } }",
      },
    },
    {
      slug: "get_item",
      summary: "Returns one item's name, group, column values and latest updates.",
      method: "POST",
      path: "/v2",
      sideEffect: "read",
      resourceType: "item",
      resource: "item_id",
      args: [
        {
          key: "item_id",
          in: "body",
          target: "variables.item_id",
          required: true,
          description: "The item's id.",
        },
      ],
      fixedBody: {
        query:
          "query ($item_id: ID!) { items(ids: [$item_id]) { id name board { id } group { id title } column_values { id text } updates(limit: 10) { id body } } }",
      },
    },
    {
      slug: "create_item",
      summary: "Creates one item on a board, optionally in a given group.",
      method: "POST",
      path: "/v2",
      sideEffect: "write_create",
      resourceType: "board",
      resource: "board_id",
      args: [
        {
          key: "board_id",
          in: "body",
          target: "variables.board_id",
          required: true,
          description: "The board's id.",
        },
        {
          key: "item_name",
          in: "body",
          target: "variables.item_name",
          required: true,
          freeText: true,
          description: "Item name.",
        },
        {
          key: "group_id",
          in: "body",
          target: "variables.group_id",
          required: false,
          description: "The group's id.",
        },
      ],
      fixedBody: {
        query:
          "mutation ($board_id: ID!, $item_name: String!, $group_id: String) { create_item(board_id: $board_id, item_name: $item_name, group_id: $group_id) { id } }",
      },
    },
    {
      slug: "create_update",
      summary: "Posts one update (comment) on an item.",
      method: "POST",
      path: "/v2",
      sideEffect: "write_create",
      resourceType: "item",
      resource: "item_id",
      args: [
        {
          key: "item_id",
          in: "body",
          target: "variables.item_id",
          required: true,
          description: "The item's id.",
        },
        {
          key: "body",
          in: "body",
          target: "variables.body",
          required: true,
          freeText: true,
          description: "Update text.",
        },
      ],
      fixedBody: {
        query:
          "mutation ($item_id: ID!, $body: String!) { create_update(item_id: $item_id, body: $body) { id } }",
      },
    },
  ],
};
