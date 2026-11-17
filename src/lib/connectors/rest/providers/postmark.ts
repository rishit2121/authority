import type { RestConnectorSpec } from "../spec";

/** https://postmarkapp.com/developer/api/overview -- a server token is sent as `X-Postmark-Server-Token: <token>`. */
export const postmark: RestConnectorSpec = {
  id: "postmark",
  name: "Postmark",
  description:
    "Search and read sent messages, read delivery stats, and send one email to a pinned recipient.",
  category: "Marketing & email",
  docsUrl: "https://postmarkapp.com/developer/api/overview",
  host: "api.postmarkapp.com",
  credential: {
    label: "Server API token",
    help: "Postmark → Servers → your server → API Tokens. The token acts only on that server.",
  },
  auth: { headers: { "X-Postmark-Server-Token": "{key}" } },
  headers: { Accept: "application/json" },
  verify: { method: "GET", path: "/server" },
  operations: [
    {
      slug: "search_outbound_messages",
      summary: "Lists the 50 most recent sent messages, optionally to one recipient.",
      method: "GET",
      path: "/messages/outbound",
      sideEffect: "read",
      resourceType: "server",
      dataSensitivity: "confidential",
      fixedQuery: { count: "50", offset: "0" },
      args: [
        {
          key: "recipient",
          in: "query",
          required: false,
          description: "Only messages sent to this address.",
        },
      ],
    },
    {
      slug: "get_outbound_message",
      summary: "Returns one sent message's details and delivery events.",
      method: "GET",
      path: "/messages/outbound/{message_id}/details",
      sideEffect: "read",
      resourceType: "message",
      resource: "message_id",
      dataSensitivity: "confidential",
      args: [
        {
          key: "message_id",
          in: "path",
          required: true,
          description: "The message id returned when it was sent.",
        },
      ],
    },
    {
      slug: "get_delivery_stats",
      summary: "Returns bounce counts and inactive-recipient totals for the server.",
      method: "GET",
      path: "/deliverystats",
      sideEffect: "read",
      resourceType: "server",
      args: [],
    },
    {
      slug: "send_email",
      summary: "Sends one plain-text email to one recipient from a confirmed sender signature.",
      method: "POST",
      path: "/email",
      sideEffect: "write_create",
      resourceType: "email_recipient",
      resource: "to",
      externalCommunication: true,
      args: [
        {
          key: "from",
          in: "body",
          target: "From",
          required: true,
          description: "Confirmed sender signature address.",
        },
        { key: "to", in: "body", target: "To", required: true, description: "Recipient email address." },
        {
          key: "subject",
          in: "body",
          target: "Subject",
          required: true,
          freeText: true,
          description: "Email subject.",
        },
        {
          key: "text_body",
          in: "body",
          target: "TextBody",
          required: true,
          freeText: true,
          description: "Plain-text body.",
        },
      ],
    },
  ],
};
