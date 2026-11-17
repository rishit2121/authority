import type { RestConnectorSpec } from "../spec";

/**
 * https://apidocs.chargebee.com/docs/api/ -- HTTP basic auth with the API key as the username and an empty password,
 * against the site's own `{site}.chargebee.com/api/v2`.
 */
export const chargebee: RestConnectorSpec = {
  id: "chargebee",
  name: "Chargebee",
  description: "List and read customers, subscriptions and invoices.",
  category: "Finance & accounting",
  docsUrl: "https://apidocs.chargebee.com/docs/api/",
  host: "{config.site}.chargebee.com",
  basePath: "/api/v2",
  credential: {
    label: "API key",
    help: "Chargebee → Settings → Configure Chargebee → API Keys and Webhooks → API Keys. A read-only key is enough.",
  },
  configFields: [
    {
      key: "site",
      label: "Chargebee site",
      placeholder: "acme (for acme.chargebee.com) or acme-test",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
  ],
  auth: { basic: { username: "{key}", password: "" } },
  verify: { method: "GET", path: "/customers?limit=1" },
  operations: [
    {
      slug: "list_customers",
      summary: "Lists customers, most recent first.",
      method: "GET",
      path: "/customers",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        { key: "limit", in: "query", type: "number", required: false, description: "Page size (1-100)." },
        { key: "offset", in: "query", required: false, description: "next_offset from a previous response." },
      ],
    },
    {
      slug: "get_customer",
      summary: "Returns one customer's details.",
      method: "GET",
      path: "/customers/{customer_id}",
      sideEffect: "read",
      resourceType: "customer",
      resource: "customer_id",
      dataSensitivity: "confidential",
      args: [{ key: "customer_id", in: "path", required: true, description: "The customer id." }],
    },
    {
      slug: "list_subscriptions",
      summary: "Lists subscriptions, optionally for one customer.",
      method: "GET",
      path: "/subscriptions",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "customer_id",
          in: "query",
          target: "customer_id[is]",
          required: false,
          description: "Only this customer's subscriptions.",
        },
        { key: "limit", in: "query", type: "number", required: false, description: "Page size (1-100)." },
        { key: "offset", in: "query", required: false, description: "next_offset from a previous response." },
      ],
    },
    {
      slug: "get_subscription",
      summary: "Returns one subscription's plan, status and billing dates.",
      method: "GET",
      path: "/subscriptions/{subscription_id}",
      sideEffect: "read",
      resourceType: "subscription",
      resource: "subscription_id",
      dataSensitivity: "confidential",
      args: [{ key: "subscription_id", in: "path", required: true, description: "The subscription id." }],
    },
    {
      slug: "list_invoices",
      summary: "Lists invoices, optionally for one customer.",
      method: "GET",
      path: "/invoices",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "customer_id",
          in: "query",
          target: "customer_id[is]",
          required: false,
          description: "Only this customer's invoices.",
        },
        { key: "limit", in: "query", type: "number", required: false, description: "Page size (1-100)." },
        { key: "offset", in: "query", required: false, description: "next_offset from a previous response." },
      ],
    },
  ],
};
