import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { googleOAuthConfig } from "./config";
import { fetchWithOptionalFixture, oauthHostname, type SafeFetchInput, type SafeFetchResult } from "./fetch";
import { gmailFixtureModeEnabled } from "./fixture-mode";

/**
 * Gmail's OAuth2 authorization-code + PKCE flow, scoped to one
 * `connector_connections` row rather than GitHub's own dedicated
 * installation lifecycle (src/lib/github/installation.ts) -- Gmail has no
 * "installation," just one tenant-created connection per Google account, so
 * the generic connector framework (connector_connections,
 * connector_connection_secrets) is the only state this needs. The state
 * parameter carries the connection id plus a CSRF nonce (verified against an
 * httpOnly cookie, same PKCE/state-cookie shape GitHub's own flow uses) —
 * there is no separate "pending install" database row to bind against.
 */

export const STATE_COOKIE = "authority_gmail_state";
export const PKCE_COOKIE = "authority_gmail_pkce";
export const COOKIE_MAX_AGE_SECONDS = 15 * 60;

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const NONCE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const b64url = (b: Buffer) => b.toString("base64url");

export interface StartedGmailOAuth {
  authorizeUrl: string;
  nonce: string;
  verifier: string;
}

export function startGmailOAuth(input: { connectionId: string; redirectUri: string }): {
  status: string;
  started?: StartedGmailOAuth;
} {
  const fixture = gmailFixtureModeEnabled();
  const cfg = googleOAuthConfig();
  if (!fixture && !cfg) return { status: "not_configured" };

  const nonce = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(48));
  const state = b64url(Buffer.from(JSON.stringify({ connectionId: input.connectionId, nonce }), "utf8"));

  if (fixture) {
    const authorizeUrl = `${input.redirectUri}?code=${encodeURIComponent(`fixture-code-${input.connectionId}`)}&state=${encodeURIComponent(state)}`;
    return { status: "ok", started: { authorizeUrl, nonce, verifier } };
  }

  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", cfg!.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SEND_SCOPE);
  // Both are required to reliably get a refresh token back: Google issues
  // one only on a user's first consent, or every time when prompt=consent
  // forces re-consent -- without this, a reconnect after a lost refresh
  // token would silently fail to obtain a new one.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { status: "ok", started: { authorizeUrl: url.toString(), nonce, verifier } };
}

/** Decodes and shape-checks the state param; never trusted beyond that until the nonce is matched against the cookie. */
export function parseGmailOAuthState(state: string | null): { connectionId: string; nonce: string } | null {
  if (!state) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    if (
      decoded &&
      typeof decoded === "object" &&
      typeof (decoded as Record<string, unknown>).connectionId === "string" &&
      typeof (decoded as Record<string, unknown>).nonce === "string"
    ) {
      return decoded as { connectionId: string; nonce: string };
    }
    return null;
  } catch {
    return null;
  }
}

export function validGmailNonce(nonce: string): boolean {
  return NONCE_SHAPE.test(nonce);
}

/** Exchanges an authorization code for a refresh token. Throws a definite error on any failure -- never returns a partial result. */
export async function exchangeGmailOAuthCode(input: {
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<string> {
  const fixture = gmailFixtureModeEnabled();
  const cfg = googleOAuthConfig();
  if (!fixture && !cfg) throw new Error("CONNECTOR_NOT_CONFIGURED");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
    client_id: fixture ? "fixture-client-id" : cfg!.clientId,
    client_secret: fixture ? "fixture-client-secret" : cfg!.clientSecret,
  });
  const response = await tokenRequest(body);
  if (Math.floor(response.status / 100) !== 2) throw new Error("OAUTH_CODE_REJECTED");
  const parsed = JSON.parse(response.bodyText) as { refresh_token?: string };
  if (!parsed.refresh_token) throw new Error("NO_REFRESH_TOKEN");
  return parsed.refresh_token;
}

/**
 * Exchanges a stored refresh token for a short-lived access token, fresh on
 * every call -- no access token is ever persisted (see
 * 20261001000012_oauth_connector_secret_type.sql's own comment). Takes an
 * injectable fetch so connector.ts's tests can supply the same fake
 * transport used for the Gmail API call itself.
 */
export async function refreshGmailAccessToken(
  refreshToken: string,
  fetchImpl: (input: SafeFetchInput) => Promise<SafeFetchResult> = fetchWithOptionalFixture,
): Promise<string> {
  const fixture = gmailFixtureModeEnabled();
  const cfg = googleOAuthConfig();
  if (!fixture && !cfg) throw new Error("CONNECTOR_NOT_CONFIGURED");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: fixture ? "fixture-client-id" : cfg!.clientId,
    client_secret: fixture ? "fixture-client-secret" : cfg!.clientSecret,
  });
  const response = await tokenRequest(body, fetchImpl);
  if (Math.floor(response.status / 100) !== 2) throw new Error("REFRESH_FAILED");
  const parsed = JSON.parse(response.bodyText) as { access_token?: string };
  if (!parsed.access_token) throw new Error("REFRESH_FAILED");
  return parsed.access_token;
}

async function tokenRequest(
  body: URLSearchParams,
  fetchImpl: (input: SafeFetchInput) => Promise<SafeFetchResult> = fetchWithOptionalFixture,
): Promise<SafeFetchResult> {
  return fetchImpl({
    url: new URL(`https://${oauthHostname()}/token`),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    timeoutMs: 10_000,
  });
}
