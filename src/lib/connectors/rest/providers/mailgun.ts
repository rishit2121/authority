import type { RestConnectorSpec } from "../spec";

/** https://documentation.mailgun.com/docs/mailgun/api-reference/ -- basic auth with username `api` and the API key as password (US region). */
export const mailgun: RestConnectorSpec = {
  id: "mailgun",
  name: "Mailgun",
  description:
    "List sending domains, read a domain's message events, and send one email to a pinned recipient.",
  category: "Marketing & email",
  docsUrl: "https://documentation.mailgun.com/docs/mailgun/api-reference/",
  iconSlug: "mailgun",
  host: "api.mailgun.net",
  credential: {
    label: "API key",
    help: "Mailgun → Account settings → API security → Add new key. US-region accounts only (api.mailgun.net).",
  },
  auth: { basic: { username: "api", password: "{key}" } },
  verify: { method: "GET", path: "/v4/domains?limit=1" },
  operations: [
    {
      slug: "list_domains",
      summary: "Lists the account's sending domains and their state.",
      method: "GET",
      path: "/v4/domains",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_events",
      summary: "Lists recent message events (delivered, failed, opened, ...) for one domain.",
      method: "GET",
      path: "/v3/{domain}/events",
      sideEffect: "read",
      resourceType: "domain",
      resource: "domain",
      dataSensitivity: "confidential",
      args: [
        {
          key: "domain",
          in: "path",
          required: true,
          description: "The sending domain, e.g. mg.example.com.",
        },
        {
          key: "event",
          in: "query",
          required: false,
          description: "Only this event type, e.g. delivered or failed.",
        },
        {
          key: "recipient",
          in: "query",
          required: false,
          description: "Only events for this recipient address.",
        },
      ],
    },
    {
      slug: "send_email",
      summary: "Sends one plain-text email from one domain to one recipient; nothing else.",
      method: "POST",
      path: "/v3/{domain}/messages",
      sideEffect: "write_create",
      resourceType: "email_recipient",
      resource: "to",
      body: "form",
      externalCommunication: true,
      args: [
        {
          key: "domain",
          in: "path",
          required: true,
          description: "The sending domain, e.g. mg.example.com.",
        },
        { key: "from", in: "body", required: true, description: "Sender address on that domain." },
        { key: "to", in: "body", required: true, description: "Recipient email address." },
        { key: "subject", in: "body", required: true, freeText: true, description: "Email subject." },
        { key: "text", in: "body", required: true, freeText: true, description: "Plain-text body." },
      ],
    },
  ],
};
