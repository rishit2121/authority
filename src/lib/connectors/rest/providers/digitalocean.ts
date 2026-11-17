import type { RestConnectorSpec } from "../spec";

/** https://docs.digitalocean.com/reference/api/ -- personal access tokens are sent as `Authorization: Bearer <token>`. */
export const digitalocean: RestConnectorSpec = {
  id: "digitalocean",
  name: "DigitalOcean",
  description: "List and read Droplets and their recent actions, and reboot one Droplet.",
  category: "Cloud & infrastructure",
  docsUrl: "https://docs.digitalocean.com/reference/api/digitalocean/",
  iconSlug: "digitalocean",
  host: "api.digitalocean.com",
  basePath: "/v2",
  credential: {
    label: "Personal access token",
    help: "DigitalOcean Control Panel → API → Tokens → Generate New Token (custom scopes: droplet read/update, account read).",
    placeholder: "dop_v1_…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/account" },
  operations: [
    {
      slug: "list_droplets",
      summary: "Lists the account's Droplets with their status, size and region.",
      method: "GET",
      path: "/droplets",
      sideEffect: "read",
      resourceType: "account",
      args: [{ key: "tag_name", in: "query", required: false, description: "Only Droplets with this tag." }],
    },
    {
      slug: "get_droplet",
      summary: "Returns one Droplet's status, size, image, region and networks.",
      method: "GET",
      path: "/droplets/{droplet_id}",
      sideEffect: "read",
      resourceType: "droplet",
      resource: "droplet_id",
      args: [
        {
          key: "droplet_id",
          in: "path",
          type: "number",
          required: true,
          description: "The Droplet's numeric id.",
        },
      ],
    },
    {
      slug: "list_droplet_actions",
      summary: "Lists the recent actions (reboots, resizes, ...) on one Droplet.",
      method: "GET",
      path: "/droplets/{droplet_id}/actions",
      sideEffect: "read",
      resourceType: "droplet",
      resource: "droplet_id",
      args: [
        {
          key: "droplet_id",
          in: "path",
          type: "number",
          required: true,
          description: "The Droplet's numeric id.",
        },
      ],
    },
    {
      slug: "reboot_droplet",
      summary: "Gracefully reboots one Droplet; changes nothing else.",
      method: "POST",
      path: "/droplets/{droplet_id}/actions",
      sideEffect: "write_update",
      resourceType: "droplet",
      resource: "droplet_id",
      args: [
        {
          key: "droplet_id",
          in: "path",
          type: "number",
          required: true,
          description: "The Droplet's numeric id.",
        },
      ],
      fixedBody: { type: "reboot" },
    },
  ],
};
