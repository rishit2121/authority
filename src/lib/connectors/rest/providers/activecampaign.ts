import type { RestConnectorSpec } from "../spec";

/**
 * https://developers.activecampaign.com/reference/overview -- API keys are sent as `Api-Token: <key>` against the
 * account's own `{account}.api-us1.com`.
 */
export const activecampaign: RestConnectorSpec = {
  id: "activecampaign",
  name: "ActiveCampaign",
  description: "Find and read contacts, list tags, create a contact, and add a tag to a contact.",
  category: "Marketing & email",
  docsUrl: "https://developers.activecampaign.com/reference/overview",
  host: "{config.account}.api-us1.com",
  basePath: "/api/3",
  credential: {
    label: "API key",
    help: "ActiveCampaign → Settings → Developer → API Access. The URL shown there gives the account name below.",
  },
  configFields: [
    {
      key: "account",
      label: "Account name",
      placeholder: "acme (for acme.api-us1.com)",
      help: "From the API URL under Settings → Developer.",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
  ],
  auth: { headers: { "Api-Token": "{key}" } },
  verify: { method: "GET", path: "/users/me" },
  operations: [
    {
      slug: "list_contacts",
      summary: "Lists contacts, optionally only the one with an exact email address.",
      method: "GET",
      path: "/contacts",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "email",
          in: "query",
          required: false,
          description: "Only the contact with this exact email.",
        },
      ],
    },
    {
      slug: "get_contact",
      summary: "Returns one contact's details.",
      method: "GET",
      path: "/contacts/{contact_id}",
      sideEffect: "read",
      resourceType: "contact",
      resource: "contact_id",
      dataSensitivity: "confidential",
      args: [
        { key: "contact_id", in: "path", type: "number", required: true, description: "The contact id." },
      ],
    },
    {
      slug: "list_tags",
      summary: "Lists the account's tags and their ids.",
      method: "GET",
      path: "/tags",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "create_contact",
      summary: "Creates one contact by email; fails if the email already exists.",
      method: "POST",
      path: "/contacts",
      sideEffect: "write_create",
      resourceType: "contact",
      resource: "email",
      dataSensitivity: "confidential",
      args: [
        {
          key: "email",
          in: "body",
          target: "contact.email",
          required: true,
          description: "The contact's email address.",
        },
        {
          key: "first_name",
          in: "body",
          target: "contact.firstName",
          required: false,
          description: "First name.",
        },
        {
          key: "last_name",
          in: "body",
          target: "contact.lastName",
          required: false,
          description: "Last name.",
        },
      ],
    },
    {
      slug: "add_tag_to_contact",
      summary: "Adds one existing tag to one contact.",
      method: "POST",
      path: "/contactTags",
      sideEffect: "write_update",
      resourceType: "contact",
      resource: "contact_id",
      dataSensitivity: "confidential",
      args: [
        {
          key: "contact_id",
          in: "body",
          target: "contactTag.contact",
          type: "number",
          required: true,
          description: "The contact id.",
        },
        {
          key: "tag_id",
          in: "body",
          target: "contactTag.tag",
          type: "number",
          required: true,
          description: "The tag id.",
        },
      ],
    },
  ],
};
