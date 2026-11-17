import type { RestConnectorSpec } from "../spec";

/**
 * https://docs.mercury.com/reference/getaccounts -- API tokens (including their `secret-token:` prefix) are sent as
 * `Authorization: Bearer <token>`.
 */
export const mercury: RestConnectorSpec = {
  id: "mercury",
  name: "Mercury",
  description: "Read-only: list and read bank accounts and their transactions.",
  category: "Finance & accounting",
  docsUrl: "https://docs.mercury.com/reference/getaccounts",
  host: "api.mercury.com",
  basePath: "/api/v1",
  credential: {
    label: "API token",
    help: "Mercury → Settings → API Tokens → create a Read Only token. Paste it including the secret-token: prefix.",
    placeholder: "secret-token:mercury_production_…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/accounts?limit=1" },
  operations: [
    {
      slug: "list_accounts",
      summary: "Lists the organization's Mercury accounts and balances.",
      method: "GET",
      path: "/accounts",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "secret",
      args: [{ key: "limit", in: "query", type: "number", required: false, description: "Page size." }],
    },
    {
      slug: "get_account",
      summary: "Returns one account's balances and details.",
      method: "GET",
      path: "/account/{account_id}",
      sideEffect: "read",
      resourceType: "bank_account",
      resource: "account_id",
      dataSensitivity: "secret",
      args: [
        { key: "account_id", in: "path", required: true, description: "The Mercury account id (UUID)." },
      ],
    },
    {
      slug: "list_transactions",
      summary: "Lists one account's transactions, newest first (last 30 days by default).",
      method: "GET",
      path: "/account/{account_id}/transactions",
      sideEffect: "read",
      resourceType: "bank_account",
      resource: "account_id",
      dataSensitivity: "secret",
      args: [
        { key: "account_id", in: "path", required: true, description: "The Mercury account id (UUID)." },
        { key: "start", in: "query", required: false, description: "Earliest date, YYYY-MM-DD." },
        { key: "end", in: "query", required: false, description: "Latest date, YYYY-MM-DD." },
        { key: "limit", in: "query", type: "number", required: false, description: "Page size (1-1000)." },
        {
          key: "offset",
          in: "query",
          type: "number",
          required: false,
          description: "Number of results to skip.",
        },
      ],
    },
    {
      slug: "get_transaction",
      summary: "Returns one transaction on an account.",
      method: "GET",
      path: "/account/{account_id}/transaction/{transaction_id}",
      sideEffect: "read",
      resourceType: "transaction",
      resource: "transaction_id",
      dataSensitivity: "secret",
      args: [
        { key: "account_id", in: "path", required: true, description: "The Mercury account id (UUID)." },
        { key: "transaction_id", in: "path", required: true, description: "The transaction id (UUID)." },
      ],
    },
  ],
};
