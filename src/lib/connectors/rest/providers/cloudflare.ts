import type { RestConnectorSpec } from "../spec";

/** https://developers.cloudflare.com/api/ -- user API tokens are sent as `Authorization: Bearer <token>`. */
export const cloudflare: RestConnectorSpec = {
  id: "cloudflare",
  name: "Cloudflare",
  description: "List zones and DNS records, read a record, and create one DNS record.",
  category: "Cloud & infrastructure",
  docsUrl: "https://developers.cloudflare.com/api/resources/dns/subresources/records/",
  iconSlug: "cloudflare",
  host: "api.cloudflare.com",
  basePath: "/client/v4",
  credential: {
    label: "API token",
    help: "Cloudflare → My Profile → API Tokens → Create Token (Zone:Read, DNS:Edit on the zones it should reach).",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  verify: { method: "GET", path: "/user/tokens/verify" },
  operations: [
    {
      slug: "list_zones",
      summary: "Lists the zones (domains) the token can see.",
      method: "GET",
      path: "/zones",
      sideEffect: "read",
      resourceType: "account",
      args: [
        { key: "name", in: "query", required: false, description: "Only the zone with this domain name." },
      ],
    },
    {
      slug: "list_dns_records",
      summary: "Lists DNS records in one zone, optionally filtered by name or type.",
      method: "GET",
      path: "/zones/{zone_id}/dns_records",
      sideEffect: "read",
      resourceType: "zone",
      resource: "zone_id",
      args: [
        { key: "zone_id", in: "path", required: true, description: "The zone id." },
        {
          key: "name",
          in: "query",
          required: false,
          description: "Only records with this exact name, e.g. www.example.com.",
        },
        {
          key: "type",
          in: "query",
          required: false,
          description: "Only records of this type, e.g. A, CNAME, TXT.",
        },
      ],
    },
    {
      slug: "get_dns_record",
      summary: "Returns one DNS record.",
      method: "GET",
      path: "/zones/{zone_id}/dns_records/{dns_record_id}",
      sideEffect: "read",
      resourceType: "dns_record",
      resource: "dns_record_id",
      args: [
        { key: "zone_id", in: "path", required: true, description: "The zone id." },
        { key: "dns_record_id", in: "path", required: true, description: "The DNS record id." },
      ],
    },
    {
      slug: "create_dns_record",
      summary: "Creates one DNS record in a zone.",
      method: "POST",
      path: "/zones/{zone_id}/dns_records",
      sideEffect: "write_create",
      resourceType: "zone",
      resource: "zone_id",
      args: [
        { key: "zone_id", in: "path", required: true, description: "The zone id." },
        { key: "type", in: "body", required: true, description: "Record type, e.g. A, AAAA, CNAME, TXT." },
        { key: "name", in: "body", required: true, description: "Record name, e.g. www.example.com." },
        {
          key: "content",
          in: "body",
          required: true,
          description: "Record value, e.g. an IP address or target hostname.",
        },
        {
          key: "ttl",
          in: "body",
          type: "number",
          required: true,
          description: "TTL in seconds; 1 means automatic.",
        },
        {
          key: "proxied",
          in: "body",
          type: "boolean",
          required: false,
          description: "Whether traffic goes through Cloudflare's proxy.",
        },
        { key: "comment", in: "body", required: false, freeText: true, description: "A note on the record." },
      ],
    },
  ],
};
