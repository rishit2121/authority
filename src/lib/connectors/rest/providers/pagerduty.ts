import type { RestConnectorSpec } from "../spec";

/**
 * https://developer.pagerduty.com/api-reference/ -- REST API keys are sent as `Authorization: Token token=<key>`;
 * writes also need a `From` header naming a valid user's email.
 */
export const pagerduty: RestConnectorSpec = {
  id: "pagerduty",
  name: "PagerDuty",
  description: "List and read incidents, acknowledge an incident, and add a note to one.",
  category: "Developer tools",
  docsUrl: "https://developer.pagerduty.com/api-reference/",
  iconSlug: "pagerduty",
  host: "api.pagerduty.com",
  credential: {
    label: "REST API key",
    help: "Integrations → API Access Keys → Create New API Key (or a user API token under My Profile → User Settings).",
  },
  configFields: [
    {
      key: "email",
      label: "Acting user email",
      placeholder: "you@company.com",
      help: "Sent as the From header; must be a PagerDuty user in the account.",
      pattern: "^[^\\s@/:]+@[^\\s@/:]+\\.[^\\s@/:]+$",
    },
  ],
  auth: { headers: { Authorization: "Token token={key}", From: "{config.email}" } },
  headers: { Accept: "application/vnd.pagerduty+json;version=2" },
  verify: { method: "GET", path: "/abilities" },
  operations: [
    {
      slug: "list_incidents",
      summary: "Lists recent incidents in the account.",
      method: "GET",
      path: "/incidents",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "get_incident",
      summary: "Returns one incident's title, status, urgency, service and assignees.",
      method: "GET",
      path: "/incidents/{incident_id}",
      sideEffect: "read",
      resourceType: "incident",
      resource: "incident_id",
      args: [
        { key: "incident_id", in: "path", required: true, description: "The incident id, e.g. PT4KHLK." },
      ],
    },
    {
      slug: "list_incident_notes",
      summary: "Lists the notes on one incident.",
      method: "GET",
      path: "/incidents/{incident_id}/notes",
      sideEffect: "read",
      resourceType: "incident",
      resource: "incident_id",
      args: [
        { key: "incident_id", in: "path", required: true, description: "The incident id, e.g. PT4KHLK." },
      ],
    },
    {
      slug: "acknowledge_incident",
      summary: "Marks one incident acknowledged; changes nothing else.",
      method: "PUT",
      path: "/incidents/{incident_id}",
      sideEffect: "write_update",
      resourceType: "incident",
      resource: "incident_id",
      args: [
        { key: "incident_id", in: "path", required: true, description: "The incident id, e.g. PT4KHLK." },
      ],
      fixedBody: { incident: { type: "incident_reference", status: "acknowledged" } },
    },
    {
      slug: "add_incident_note",
      summary: "Adds one note to an incident's timeline.",
      method: "POST",
      path: "/incidents/{incident_id}/notes",
      sideEffect: "write_create",
      resourceType: "incident",
      resource: "incident_id",
      args: [
        { key: "incident_id", in: "path", required: true, description: "The incident id, e.g. PT4KHLK." },
        {
          key: "content",
          in: "body",
          target: "note.content",
          required: true,
          freeText: true,
          description: "Note text.",
        },
      ],
    },
  ],
};
