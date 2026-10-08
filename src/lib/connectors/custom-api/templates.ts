/**
 * Pre-filled starting points for the Custom API connector's own operation
 * draft form -- never a new connector, never a new execution path. Every
 * template produces exactly the same kind of operation definition an admin
 * could type in by hand; selecting one just fills the form.
 *
 * Deliberately excludes anything Custom API's flat, scalar-only body model
 * (src/lib/connectors/custom-api/request-builder.ts: one declared field is
 * exactly one top-level JSON body key -- string/number/boolean only, no
 * nested objects, no arrays) cannot represent faithfully: a pure-GraphQL
 * API (Linear has no REST surface at all), and most "create" endpoints on
 * REST APIs that wrap their payload in a nested object (Notion page
 * creation, HubSpot/Zendesk/Asana/Airtable write endpoints all require a
 * nested properties/fields/data object -- confirmed against each
 * provider's own API reference, not assumed). Every template below is
 * flat by construction: a GET-by-id read, or -- where the write endpoint's
 * real body genuinely is flat -- one write.
 *
 * Best-effort, not live-verified: built from each provider's public API
 * documentation, the same way an admin filling the form in by hand would
 * -- never exercised against a real account here (this repo holds no
 * credentials for any of them). Always run "Preview request" and check
 * the provider's own current docs before publishing one in production;
 * see each template's own `verify` note for the one thing most likely to
 * need adjusting for a specific account.
 */

export interface CustomApiTemplateField {
  key: string;
  in: "path" | "query" | "body";
  type: "string" | "number" | "boolean";
  required: boolean;
  identifiesResource: boolean;
  placeholder: string;
}

export interface CustomApiTemplate {
  id: string;
  service: string;
  name: string;
  description: string;
  /** Shown as a hint; the connection's own Base URL field must be set to this (or an account-specific variant -- see `verify`). */
  recommendedBaseUrl: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string;
  effect: "read" | "write_create" | "write_update" | "write_delete" | "admin";
  authType: "none" | "bearer" | "api_key_header" | "basic";
  headerName?: string;
  authNote: string;
  staticHeaders: Array<{ name: string; value: string }>;
  fields: CustomApiTemplateField[];
  /** The one thing most likely to need checking/adjusting for a specific account, beyond the credential itself. */
  verify: string;
}

export const CUSTOM_API_TEMPLATES: CustomApiTemplate[] = [
  {
    id: "notion-retrieve-page",
    service: "Notion",
    name: "Retrieve a page",
    description: "Reads one Notion page's properties by id.",
    recommendedBaseUrl: "https://api.notion.com/v1",
    method: "GET",
    pathTemplate: "/pages/{page_id}",
    effect: "read",
    authType: "bearer",
    authNote:
      'An internal integration token from notion.so/my-integrations, shared with the page via "Connections".',
    staticHeaders: [{ name: "Notion-Version", value: "2022-06-28" }],
    fields: [
      {
        key: "page_id",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: true,
        placeholder: "the Notion page id (from its URL)",
      },
    ],
    verify:
      "Notion-Version is pinned to 2022-06-28 here -- bump it if your workspace needs a newer API version.",
  },
  {
    id: "hubspot-get-contact",
    service: "HubSpot",
    name: "Get a contact",
    description: "Reads one CRM contact by its HubSpot object id.",
    recommendedBaseUrl: "https://api.hubapi.com",
    method: "GET",
    pathTemplate: "/crm/v3/objects/contacts/{contactId}",
    effect: "read",
    authType: "bearer",
    authNote:
      "A private app access token (Settings -> Integrations -> Private Apps), scoped to crm.objects.contacts.read.",
    staticHeaders: [],
    fields: [
      {
        key: "contactId",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: true,
        placeholder: "the HubSpot contact id",
      },
    ],
    verify:
      'Returns HubSpot\'s default property set only -- add a "properties" query field (comma-separated names) if you need specific ones.',
  },
  {
    id: "zendesk-get-ticket",
    service: "Zendesk",
    name: "Get a ticket",
    description: "Reads one support ticket by id.",
    recommendedBaseUrl: "https://<your-subdomain>.zendesk.com/api/v2",
    method: "GET",
    pathTemplate: "/tickets/{ticket_id}.json",
    effect: "read",
    authType: "basic",
    authNote:
      'Username is your agent email with "/token" appended (e.g. you@company.com/token); password is an API token from Admin Center -> Apps and integrations -> APIs.',
    staticHeaders: [],
    fields: [
      {
        key: "ticket_id",
        in: "path",
        type: "number",
        required: true,
        identifiesResource: true,
        placeholder: "the ticket number",
      },
    ],
    verify: "Replace <your-subdomain> in the connection's Base URL with your own Zendesk subdomain.",
  },
  {
    id: "discord-send-message",
    service: "Discord",
    name: "Send a channel message",
    description: "Posts one text message to a channel, as the bot.",
    recommendedBaseUrl: "https://discord.com/api/v10",
    method: "POST",
    pathTemplate: "/channels/{channel_id}/messages",
    effect: "write_create",
    authType: "api_key_header",
    headerName: "Authorization",
    authNote:
      'Paste the FULL value including the scheme: "Bot <your bot token>" (from the Discord Developer Portal -> your app -> Bot) -- Custom API\'s "bearer" auth always sends the standard "Bearer " prefix, which Discord\'s bot auth does not use.',
    staticHeaders: [],
    fields: [
      {
        key: "channel_id",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: true,
        placeholder: "the Discord channel id",
      },
      {
        key: "content",
        in: "body",
        type: "string",
        required: true,
        identifiesResource: false,
        placeholder: "message text",
      },
    ],
    verify:
      'The bot must already be a member of the server and have "Send Messages" permission in that channel.',
  },
  {
    id: "airtable-get-record",
    service: "Airtable",
    name: "Get a record",
    description: "Reads one record from a base/table.",
    recommendedBaseUrl: "https://api.airtable.com/v0",
    method: "GET",
    pathTemplate: "/{baseId}/{tableName}/{recordId}",
    effect: "read",
    authType: "bearer",
    authNote:
      "A personal access token (airtable.com/create/tokens) scoped to data.records:read on this base.",
    staticHeaders: [],
    fields: [
      {
        key: "baseId",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: false,
        placeholder: "appXXXXXXXXXXXXXX",
      },
      {
        key: "tableName",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: false,
        placeholder: "the table name or id",
      },
      {
        key: "recordId",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: true,
        placeholder: "recXXXXXXXXXXXXXX",
      },
    ],
    verify:
      "tableName is URL-path-sensitive -- use the table's id (tblXXXXXXXXXXXXXX) instead of its display name if the name contains spaces or special characters.",
  },
  {
    id: "intercom-get-contact",
    service: "Intercom",
    name: "Get a contact",
    description: "Reads one contact by its Intercom id.",
    recommendedBaseUrl: "https://api.intercom.io",
    method: "GET",
    pathTemplate: "/contacts/{id}",
    effect: "read",
    authType: "bearer",
    authNote:
      "An access token from your Intercom app's Developer Hub (or Settings -> Integrations -> Authentication for a simple token).",
    staticHeaders: [],
    fields: [
      {
        key: "id",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: true,
        placeholder: "the Intercom contact id",
      },
    ],
    verify:
      "Intercom contact ids are Intercom's own internal ids, not an email address -- look one up first if you only have an email.",
  },
  {
    id: "intercom-create-contact",
    service: "Intercom",
    name: "Create a contact",
    description: "Creates (or, if the email already exists, may conflict -- see verify) a contact.",
    recommendedBaseUrl: "https://api.intercom.io",
    method: "POST",
    pathTemplate: "/contacts",
    effect: "write_create",
    authType: "bearer",
    authNote: 'Same access token as "Get a contact" above, scoped to write contacts.',
    staticHeaders: [],
    fields: [
      {
        key: "email",
        in: "body",
        type: "string",
        required: true,
        identifiesResource: true,
        placeholder: "person@example.com",
      },
      {
        key: "role",
        in: "body",
        type: "string",
        required: false,
        identifiesResource: false,
        placeholder: "user or lead",
      },
    ],
    verify:
      "Intercom returns 409 Conflict if a contact with this email already exists -- this template does not upsert.",
  },
  {
    id: "mailchimp-get-member",
    service: "Mailchimp",
    name: "Get a list member",
    description: "Reads one audience member's subscription status.",
    recommendedBaseUrl: "https://<dc>.api.mailchimp.com/3.0",
    method: "GET",
    pathTemplate: "/lists/{list_id}/members/{subscriber_hash}",
    effect: "read",
    authType: "basic",
    authNote: 'Username can be any non-empty string (e.g. "anystring"); password is your Mailchimp API key.',
    staticHeaders: [],
    fields: [
      {
        key: "list_id",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: false,
        placeholder: "the audience/list id",
      },
      {
        key: "subscriber_hash",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: true,
        placeholder: "lowercase MD5 of the member's email",
      },
    ],
    verify:
      'Replace <dc> in the Base URL with your account\'s datacenter (the suffix of your API key after the dash, e.g. key ending "-us6" -> dc is "us6"). subscriber_hash must be computed as md5(lowercase(email)) by the caller before this call.',
  },
  {
    id: "asana-get-task",
    service: "Asana",
    name: "Get a task",
    description: "Reads one task by its Asana global id.",
    recommendedBaseUrl: "https://app.asana.com/api/1.0",
    method: "GET",
    pathTemplate: "/tasks/{task_gid}",
    effect: "read",
    authType: "bearer",
    authNote:
      "A personal access token from asana.com -> Settings -> Apps -> Developer apps -> Personal access tokens.",
    staticHeaders: [],
    fields: [
      {
        key: "task_gid",
        in: "path",
        type: "string",
        required: true,
        identifiesResource: true,
        placeholder: "the task's gid",
      },
    ],
    verify:
      "A personal access token acts as that person -- it can only read tasks that person themself can see.",
  },
];
