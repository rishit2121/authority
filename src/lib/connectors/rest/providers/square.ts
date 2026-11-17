import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.squareup.com/reference/square -- access tokens are sent as `Authorization: Bearer <token>`, with a
 * pinned `Square-Version` header.
 */
export const square: RestConnectorSpec = {
  id: "square",
  name: "Square",
  description: "List locations, payments and customers, and read one payment or customer.",
  category: "Commerce & payments",
  docsUrl: "https://developer.squareup.com/reference/square",
  iconSlug: "square",
  host: "connect.squareup.com",
  basePath: "/v2",
  credential: {
    label: "Access token",
    help: "Square Developer Console → your application → Credentials → Production access token (or a token with PAYMENTS_READ, CUSTOMERS_READ and MERCHANT_PROFILE_READ).",
    placeholder: "EAAA…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  headers: { "Square-Version": "2026-09-16" },
  verify: { method: "GET", path: "/locations" },
  operations: [
    {
      slug: "list_locations",
      summary: "Lists the seller's business locations.",
      method: "GET",
      path: "/locations",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_payments",
      summary: "Lists recent payments, optionally for one location or time window.",
      method: "GET",
      path: "/payments",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "location_id",
          in: "query",
          required: false,
          description: "Only payments taken at this location.",
        },
        {
          key: "begin_time",
          in: "query",
          required: false,
          description: "RFC 3339 start of the time window.",
        },
        { key: "end_time", in: "query", required: false, description: "RFC 3339 end of the time window." },
        {
          key: "limit",
          in: "query",
          type: "number",
          required: false,
          description: "Page size (at most 100).",
        },
        {
          key: "cursor",
          in: "query",
          required: false,
          description: "Pagination cursor from a previous response.",
        },
      ],
    },
    {
      slug: "get_payment",
      summary: "Returns one payment's amount, status, card details and receipt.",
      method: "GET",
      path: "/payments/{payment_id}",
      sideEffect: "read",
      resourceType: "payment",
      resource: "payment_id",
      dataSensitivity: "confidential",
      args: [{ key: "payment_id", in: "path", required: true, description: "The payment id." }],
    },
    {
      slug: "list_customers",
      summary: "Lists customer profiles in the seller's directory.",
      method: "GET",
      path: "/customers",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        { key: "limit", in: "query", type: "number", required: false, description: "Page size (1-100)." },
        {
          key: "cursor",
          in: "query",
          required: false,
          description: "Pagination cursor from a previous response.",
        },
      ],
    },
    {
      slug: "get_customer",
      summary: "Returns one customer profile.",
      method: "GET",
      path: "/customers/{customer_id}",
      sideEffect: "read",
      resourceType: "customer",
      resource: "customer_id",
      dataSensitivity: "confidential",
      args: [{ key: "customer_id", in: "path", required: true, description: "The customer id." }],
    },
  ],
};
