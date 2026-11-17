import type { RestConnectorSpec } from "../spec";

/** https://developer.brex.com/openapi/transactions_api/ -- user tokens are sent as `Authorization: Bearer <token>`. */
export const brex: RestConnectorSpec = {
  id: "brex",
  name: "Brex",
  description:
    "Read-only: list cash and card accounts, card transactions, and a cash account's transactions.",
  category: "Finance & accounting",
  docsUrl: "https://developer.brex.com/openapi/transactions_api/",
  iconSlug: "brex",
  host: "api.brex.com",
  credential: {
    label: "User token",
    help: "Brex dashboard → Developer → Create token, with read-only scopes (accounts.cash.readonly, accounts.card.readonly, transactions.card.readonly, transactions.cash.readonly).",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/v2/accounts/cash" },
  operations: [
    {
      slug: "list_cash_accounts",
      summary: "Lists the company's Brex business (cash) accounts and balances.",
      method: "GET",
      path: "/v2/accounts/cash",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "secret",
      args: [],
    },
    {
      slug: "list_card_accounts",
      summary: "Lists the company's card accounts and balances.",
      method: "GET",
      path: "/v2/accounts/card",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "secret",
      args: [],
    },
    {
      slug: "list_card_transactions",
      summary: "Lists settled transactions on the primary card account.",
      method: "GET",
      path: "/v2/transactions/card/primary",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "secret",
      args: [
        {
          key: "posted_at_start",
          in: "query",
          required: false,
          description: "ISO 8601 date-time; only transactions posted at or after it.",
        },
        { key: "limit", in: "query", type: "number", required: false, description: "Page size." },
        {
          key: "cursor",
          in: "query",
          required: false,
          description: "Pagination cursor from a previous response.",
        },
      ],
    },
    {
      slug: "list_cash_transactions",
      summary: "Lists transactions on one cash account.",
      method: "GET",
      path: "/v2/transactions/cash/{account_id}",
      sideEffect: "read",
      resourceType: "cash_account",
      resource: "account_id",
      dataSensitivity: "secret",
      args: [
        { key: "account_id", in: "path", required: true, description: "The cash account id." },
        {
          key: "posted_at_start",
          in: "query",
          required: false,
          description: "ISO 8601 date-time; only transactions posted at or after it.",
        },
        { key: "limit", in: "query", type: "number", required: false, description: "Page size." },
        {
          key: "cursor",
          in: "query",
          required: false,
          description: "Pagination cursor from a previous response.",
        },
      ],
    },
  ],
};
