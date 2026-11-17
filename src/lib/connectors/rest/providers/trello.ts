import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.atlassian.com/cloud/trello/rest/ -- requests carry the (non-secret) API key and the user token as
 * the `key=` and `token=` query parameters.
 */
export const trello: RestConnectorSpec = {
  id: "trello",
  name: "Trello",
  description: "List and read cards, create a card in a list, and comment on a card.",
  category: "Project management",
  docsUrl: "https://developer.atlassian.com/cloud/trello/rest/api-group-cards/",
  iconSlug: "trello",
  host: "api.trello.com",
  basePath: "/1",
  credential: {
    label: "API token",
    help: "trello.com/power-ups/admin → your Power-Up → API key → generate a token by following the Token link. Enter the API key below.",
  },
  configFields: [
    {
      key: "api_key",
      label: "API key",
      placeholder: "32-character hex key",
      help: "The Power-Up's API key (not secret); the token above is the secret.",
      pattern: "^[0-9a-f]{32}$",
    },
  ],
  auth: { query: { key: "{config.api_key}", token: "{key}" } },
  verify: { method: "GET", path: "/members/me" },
  operations: [
    {
      slug: "list_cards",
      summary: "Lists the open cards in one list.",
      method: "GET",
      path: "/lists/{list_id}/cards",
      sideEffect: "read",
      resourceType: "list",
      resource: "list_id",
      args: [{ key: "list_id", in: "path", required: true, description: "The list's id." }],
    },
    {
      slug: "get_card",
      summary: "Returns one card's name, description, due date and members.",
      method: "GET",
      path: "/cards/{card_id}",
      sideEffect: "read",
      resourceType: "card",
      resource: "card_id",
      args: [{ key: "card_id", in: "path", required: true, description: "The card's id." }],
    },
    {
      slug: "create_card",
      summary: "Creates one card at the bottom of a list.",
      method: "POST",
      path: "/cards",
      sideEffect: "write_create",
      resourceType: "list",
      resource: "list_id",
      args: [
        { key: "list_id", in: "query", target: "idList", required: true, description: "The list's id." },
        { key: "name", in: "query", required: true, freeText: true, description: "Card name." },
        { key: "desc", in: "query", required: false, freeText: true, description: "Card description." },
      ],
      fixedQuery: { pos: "bottom" },
    },
    {
      slug: "add_comment",
      summary: "Adds one comment to a card.",
      method: "POST",
      path: "/cards/{card_id}/actions/comments",
      sideEffect: "write_create",
      resourceType: "card",
      resource: "card_id",
      args: [
        { key: "card_id", in: "path", required: true, description: "The card's id." },
        { key: "text", in: "query", required: true, freeText: true, description: "Comment text." },
      ],
    },
  ],
};
