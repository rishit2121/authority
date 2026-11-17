import type { RestConnectorSpec } from "../spec";

/**
 * https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/ -- API tokens are sent as
 * `Authorization: Bearer <token>`.
 */
export const betterstack: RestConnectorSpec = {
  id: "betterstack",
  name: "Better Stack",
  description: "List monitors and incidents, read an incident, and acknowledge or resolve it.",
  category: "Developer tools",
  docsUrl: "https://betterstack.com/docs/uptime/api/list-all-incidents/",
  iconSlug: "betterstack",
  host: "incidents.betterstack.com",
  basePath: "/api",
  credential: {
    label: "API token",
    help: "Better Stack → API tokens → Team-based tokens → select the team and create an Incidents API token.",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/v2/monitors?per_page=1" },
  operations: [
    {
      slug: "list_monitors",
      summary: "Lists the team's uptime monitors and their status.",
      method: "GET",
      path: "/v2/monitors",
      sideEffect: "read",
      resourceType: "account",
      args: [],
    },
    {
      slug: "list_incidents",
      summary: "Lists incidents, optionally only unresolved ones.",
      method: "GET",
      path: "/v4/incidents",
      sideEffect: "read",
      resourceType: "account",
      args: [
        {
          key: "resolved",
          in: "query",
          type: "boolean",
          required: false,
          description: "true for resolved only, false for unresolved only.",
        },
        {
          key: "monitor_id",
          in: "query",
          required: false,
          description: "Only incidents for this monitor id.",
        },
      ],
    },
    {
      slug: "get_incident",
      summary: "Returns one incident's cause, status and timestamps.",
      method: "GET",
      path: "/v4/incidents/{incident_id}",
      sideEffect: "read",
      resourceType: "incident",
      resource: "incident_id",
      args: [{ key: "incident_id", in: "path", required: true, description: "The incident id." }],
    },
    {
      slug: "acknowledge_incident",
      summary: "Acknowledges one ongoing incident; changes nothing else.",
      method: "POST",
      path: "/v4/incidents/{incident_id}/acknowledge",
      sideEffect: "write_update",
      resourceType: "incident",
      resource: "incident_id",
      args: [
        { key: "incident_id", in: "path", required: true, description: "The incident id." },
        {
          key: "acknowledged_by",
          in: "body",
          required: false,
          description: "Email or identifier of who acknowledged it.",
        },
      ],
    },
    {
      slug: "resolve_incident",
      summary: "Resolves one ongoing incident; changes nothing else.",
      method: "POST",
      path: "/v4/incidents/{incident_id}/resolve",
      sideEffect: "write_update",
      resourceType: "incident",
      resource: "incident_id",
      args: [
        { key: "incident_id", in: "path", required: true, description: "The incident id." },
        {
          key: "resolved_by",
          in: "body",
          required: false,
          description: "Email or identifier of who resolved it.",
        },
      ],
    },
  ],
};
