import type { RestConnectorSpec } from "../spec";

/** https://docs.apollo.io/reference/authentication -- API keys are sent in the `x-api-key` header to api.apollo.io. */
export const apollo: RestConnectorSpec = {
  id: "apollo",
  name: "Apollo",
  description: "Search and read your Apollo contacts, and create a contact.",
  category: "CRM & sales",
  docsUrl: "https://docs.apollo.io/reference/search-for-contacts",
  host: "api.apollo.io",
  basePath: "/api/v1",
  credential: {
    label: "API key",
    help: "Settings → Integrations → API → API Keys → create a key with the contacts endpoints enabled.",
  },
  auth: { headers: { "x-api-key": "{key}" } },
  verify: { method: "GET", path: "/users/api_profile" },
  operations: [
    {
      slug: "search_contacts",
      summary: "Searches the contacts your team has added to Apollo by keyword.",
      method: "POST",
      path: "/contacts/search",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "q_keywords",
          in: "body",
          required: true,
          description: "Name, title, company or email to search for.",
        },
        { key: "per_page", in: "body", type: "number", required: false, description: "Results per page." },
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
      args: [{ key: "contact_id", in: "path", required: true, description: "The Apollo contact id." }],
    },
    {
      slug: "create_contact",
      summary: "Creates one contact in your Apollo account.",
      method: "POST",
      path: "/contacts",
      sideEffect: "write_create",
      resourceType: "account",
      dataSensitivity: "confidential",
      fixedBody: { run_dedupe: true },
      args: [
        { key: "first_name", in: "body", required: true, description: "First name." },
        { key: "last_name", in: "body", required: true, description: "Last name." },
        { key: "email", in: "body", required: false, description: "Email address." },
        { key: "organization_name", in: "body", required: false, description: "Company name." },
        { key: "title", in: "body", required: false, description: "Job title." },
      ],
    },
  ],
};
