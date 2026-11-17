import type { RestConnectorSpec } from "../spec";

/** https://cal.com/docs/api-reference/v2/introduction -- API keys are sent as `Authorization: Bearer cal_…` with a pinned `cal-api-version`. */
export const calcom: RestConnectorSpec = {
  id: "calcom",
  name: "Cal.com",
  description: "List bookings and read one booking's details and attendees.",
  category: "Productivity",
  docsUrl: "https://cal.com/docs/api-reference/v2/introduction",
  iconSlug: "caldotcom",
  host: "api.cal.com",
  credential: {
    label: "API key",
    help: "Cal.com → Settings → Developer → API keys → Add.",
    placeholder: "cal_live_…",
  },
  auth: { headers: { Authorization: "Bearer {key}" } },
  headers: { "cal-api-version": "2024-08-13" },
  verify: { method: "GET", path: "/v2/me" },
  operations: [
    {
      slug: "list_bookings",
      summary: "Lists the user's bookings, optionally by status (upcoming, past, cancelled…).",
      method: "GET",
      path: "/v2/bookings",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        {
          key: "status",
          in: "query",
          required: false,
          description: "upcoming, recurring, past, cancelled or unconfirmed (comma-separated).",
        },
        {
          key: "take",
          in: "query",
          type: "number",
          required: false,
          description: "How many bookings to return.",
        },
      ],
    },
    {
      slug: "get_booking",
      summary: "Returns one booking's time, event type, location and attendees.",
      method: "GET",
      path: "/v2/bookings/{booking_uid}",
      sideEffect: "read",
      resourceType: "booking",
      resource: "booking_uid",
      dataSensitivity: "confidential",
      args: [{ key: "booking_uid", in: "path", required: true, description: "The booking's uid." }],
    },
  ],
};
