import "server-only";

import { safeFetch, type SafeFetchInput, type SafeFetchResult } from "../custom-api/network-guard";
import { GMAIL_FIXTURE_HOSTNAME, gmailFixtureModeEnabled } from "./fixture-mode";

/**
 * Routes the one reserved fixture hostname to the in-process fake Google
 * OAuth/Gmail API when fixture mode is explicitly enabled; every other
 * destination -- and this hostname itself when the mode is off -- always
 * goes through the real `safeFetch`. Shared by oauth.ts (token exchange/
 * refresh) and connector.ts (the Gmail send call) so both upstream hosts
 * funnel through the same fixture, same reasoning as
 * ../stripe/connector.ts's own `fetchWithOptionalFixture`.
 */
export async function fetchWithOptionalFixture(input: SafeFetchInput): Promise<SafeFetchResult> {
  if (gmailFixtureModeEnabled() && input.url.hostname === GMAIL_FIXTURE_HOSTNAME) {
    const { gmailFixtureServer } = await import("./fixture-server");
    return gmailFixtureServer().handle(input);
  }
  return safeFetch(input);
}

/** The fixture hostname when fixture mode is on; Google's real hosts otherwise. Never tenant-configurable. */
export function oauthHostname(): string {
  return gmailFixtureModeEnabled() ? GMAIL_FIXTURE_HOSTNAME : "oauth2.googleapis.com";
}

export function gmailApiHostname(): string {
  return gmailFixtureModeEnabled() ? GMAIL_FIXTURE_HOSTNAME : "gmail.googleapis.com";
}

export type { SafeFetchInput, SafeFetchResult };
