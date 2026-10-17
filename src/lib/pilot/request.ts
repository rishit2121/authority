import { createHash } from "node:crypto";

import { z } from "zod";

import { PILOT_LIMITS } from "./limits";

/**
 * The public pilot request form. Validated here and again in the database
 * function (gateway.submit_pilot_request), which enforces the same limits.
 */

export { PILOT_LIMITS };

export const PILOT_REQUEST_RECEIVED_MESSAGE =
  "Thanks—your request has been received. We'll reach out if there's a fit for the pilot.";

export const PILOT_RATE_LIMITED_MESSAGE = "Too many requests from here. Try again in an hour.";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

export const pilotRequestSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(PILOT_LIMITS.name, "That name is too long."),
  email: z
    .string()
    .trim()
    .min(3, "Enter a valid email address.")
    .max(PILOT_LIMITS.email, "That email address is too long.")
    .pipe(z.email("Enter a valid email address.")),
  company: optionalText(PILOT_LIMITS.company),
  building: z
    .string()
    .trim()
    .min(1, "Tell us what you're building.")
    .max(PILOT_LIMITS.building, `Keep this under ${PILOT_LIMITS.building} characters.`),
  usage: z
    .string()
    .trim()
    .min(1, "Tell us how you'd use Authority.")
    .max(PILOT_LIMITS.usage, `Keep this under ${PILOT_LIMITS.usage} characters.`),
  services: optionalText(PILOT_LIMITS.services),
});

export type PilotRequestInput = z.infer<typeof pilotRequestSchema>;

/** Dedup key: trimmed, lowercased. The database uses the same rule. */
export function normalizePilotEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The client address for rate limiting, hashed so raw IPs are never stored.
 * Render (and most proxies) put the client first in x-forwarded-for.
 */
export function clientIpHash(forwardedFor: string | null, realIp: string | null, salt = ""): string {
  const ip = forwardedFor?.split(",")[0]?.trim() || realIp?.trim() || "unknown";
  return createHash("sha256").update(`authority-pilot:${salt}:${ip}`).digest("hex");
}
