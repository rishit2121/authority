import type { RestConnectorSpec } from "../spec";

/** https://resend.com/docs/api-reference/introduction -- API keys are sent as `Authorization: Bearer <key>`. */
export const resend: RestConnectorSpec = {
  id: "resend",
  name: "Resend",
  description: "List sending domains, read one sent email, and send one email to a pinned recipient.",
  category: "Marketing & email",
  docsUrl: "https://resend.com/docs/api-reference/introduction",
  iconSlug: "resend",
  host: "api.resend.com",
  credential: {
    label: "API key",
    help: "Resend → API Keys → Create API Key with Full access (a Sending-access key cannot list domains or read emails).",
    placeholder: "re_…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/domains" },
  operations: [
    {
      slug: "list_domains",
      summary: "Lists the account's sending domains and their verification status.",
      method: "GET",
      path: "/domains",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_email",
      summary: "Returns one sent email's recipients, subject and last delivery event.",
      method: "GET",
      path: "/emails/{email_id}",
      sideEffect: "read",
      resourceType: "email",
      resource: "email_id",
      dataSensitivity: "confidential",
      args: [
        {
          key: "email_id",
          in: "path",
          required: true,
          description: "The email id returned when it was sent.",
        },
      ],
    },
    {
      slug: "send_email",
      summary: "Sends one plain-text email to one recipient from a verified domain; nothing else.",
      method: "POST",
      path: "/emails",
      sideEffect: "write_create",
      resourceType: "email_recipient",
      resource: "to",
      externalCommunication: true,
      args: [
        { key: "from", in: "body", required: true, description: "Sender address on a verified domain." },
        { key: "to", in: "body", required: true, description: "Recipient email address." },
        { key: "subject", in: "body", required: true, freeText: true, description: "Email subject." },
        { key: "text", in: "body", required: true, freeText: true, description: "Plain-text body." },
      ],
    },
  ],
};
