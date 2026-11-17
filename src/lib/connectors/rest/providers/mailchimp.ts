import type { RestConnectorSpec } from "../spec";

/**
 * https://mailchimp.com/developer/marketing/api/ -- API keys use basic auth with any username and the key as the
 * password, against the key's own datacenter host `{dc}.api.mailchimp.com` (the `-usX` suffix of the key).
 */
export const mailchimp: RestConnectorSpec = {
  id: "mailchimp",
  name: "Mailchimp",
  description:
    "List audiences, look up one member, and add one member to an audience as pending (double opt-in).",
  category: "Marketing & email",
  docsUrl: "https://mailchimp.com/developer/marketing/api/",
  iconSlug: "mailchimp",
  host: "{config.dc}.api.mailchimp.com",
  basePath: "/3.0",
  credential: {
    label: "API key",
    help: "Mailchimp → Profile → Extras → API keys → Create A Key. The part after the dash (e.g. us21) is the datacenter below.",
    placeholder: "…-us21",
  },
  configFields: [
    {
      key: "dc",
      label: "Datacenter",
      placeholder: "us21",
      help: "The suffix after the dash in your API key.",
      pattern: "^us[0-9]{1,3}$",
    },
  ],
  auth: { basic: { username: "anystring", password: "{key}" } },
  verify: { method: "GET", path: "/ping" },
  operations: [
    {
      slug: "list_audiences",
      summary: "Lists the account's audiences (lists) with member counts.",
      method: "GET",
      path: "/lists",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_member",
      summary: "Returns one audience member's status and merge fields.",
      method: "GET",
      path: "/lists/{list_id}/members/{subscriber_hash}",
      sideEffect: "read",
      resourceType: "audience",
      resource: "list_id",
      dataSensitivity: "confidential",
      args: [
        { key: "list_id", in: "path", required: true, description: "The audience (list) id." },
        {
          key: "subscriber_hash",
          in: "path",
          required: true,
          description: "MD5 hash of the member's lowercase email, or the email address or contact_id.",
        },
      ],
    },
    {
      slug: "add_member",
      summary: "Adds one address to an audience as pending; Mailchimp emails them a confirmation to opt in.",
      method: "POST",
      path: "/lists/{list_id}/members",
      sideEffect: "write_create",
      resourceType: "audience",
      resource: "list_id",
      dataSensitivity: "confidential",
      externalCommunication: true,
      fixedBody: { status: "pending" },
      args: [
        { key: "list_id", in: "path", required: true, description: "The audience (list) id." },
        { key: "email_address", in: "body", required: true, description: "The address to add." },
      ],
    },
  ],
};
