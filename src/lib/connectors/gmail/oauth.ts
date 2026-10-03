import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { googleOAuthConfig } from "./config";
import {
  fetchWithOptionalFixture,
  gmailApiHostname,
  oauthHostname,
  type SafeFetchInput,
  type SafeFetchResult,
} from "./fetch";
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

/**
 * The narrowest combination of Google-defined scopes that exactly covers
 * every operation this connector implements (../connector.ts):
 * `gmail.readonly` for list_messages/get_message/list_labels and the
 * account-label lookup (`users.getProfile`), `gmail.send` for send_email.
 * Neither allows what this connector never does -- permanently deleting
 * mail (bypassing trash), modifying or moving existing messages/labels, or
 * touching account settings -- all of which the previously-requested
 * `https://mail.google.com/` scope did allow. Both are still in Google's
 * "restricted"/"sensitive" OAuth tiers (reading message content is
 * inherently sensitive; there is no scope that both reads mail and skips
 * that), so this does not reduce Google's own app-verification
 * requirement -- the benefit is a smaller blast radius if a stored
 * refresh token is ever compromised, not a lighter review process.
 *
 * Authority's own capability/contract system is still what actually
 * decides which of this connector's fixed, individually-audited
 * operations an agent may call for a given task -- this scope only bounds
 * what the stored credential itself could ever be used for, independent
 * of Authority.
 *
 * This only changes what a NEW OAuth consent requests. An already-connected
 * account's stored refresh token keeps whatever scope it originally
 * consented to (Google does not retroactively narrow an issued token) --
 * nothing about an existing connection changes until that account
 * disconnects and reconnects, which re-runs this same consent screen under
 * the new, narrower scope.
 */
const GMAIL_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
const NONCE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const b64url = (b: Buffer) => b.toString("base64url");

export interface StartedGmailOAuth {
  authorizeUrl: string;
  nonce: string;
  verifier: string;
}

/**
 * `connectionId` is the dashboard-operated flow's own identity (an
 * already-created `connector_connections` row waiting for its secret).
 * `sessionToken` is the embedded flow's identity instead (a
 * `connection_sessions` token -- no connection row exists yet; one is
 * created only once the exchange below succeeds). Exactly one must be set;
 * both travel through Google's own `state` round-trip unchanged, the same
 * mechanism either way.
 */
export function startGmailOAuth(input: {
  connectionId?: string;
  sessionToken?: string;
  redirectUri: string;
}): {
  status: string;
  started?: StartedGmailOAuth;
} {
  const fixture = gmailFixtureModeEnabled();
  const cfg = googleOAuthConfig();
  if (!fixture && !cfg) return { status: "not_configured" };

  const nonce = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(48));
  const state = b64url(
    Buffer.from(
      JSON.stringify({
        connectionId: input.connectionId ?? null,
        sessionToken: input.sessionToken ?? null,
        nonce,
      }),
      "utf8",
    ),
  );

  if (fixture) {
    const fixtureSuffix = input.connectionId ?? input.sessionToken ?? "unknown";
    const authorizeUrl = `${input.redirectUri}?code=${encodeURIComponent(`fixture-code-${fixtureSuffix}`)}&state=${encodeURIComponent(state)}`;
    return { status: "ok", started: { authorizeUrl, nonce, verifier } };
  }

  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", cfg!.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
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

export interface ParsedGmailOAuthState {
  connectionId: string | null;
  sessionToken: string | null;
  nonce: string;
}

/**
 * Decodes and shape-checks the state param; never trusted beyond that until
 * the nonce is matched against the cookie. Exactly one of connectionId/
 * sessionToken is expected to be non-null -- which one tells a callback
 * route which flow (dashboard vs. embedded) produced this round trip.
 */
export function parseGmailOAuthState(state: string | null): ParsedGmailOAuthState | null {
  if (!state) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    if (
      decoded &&
      typeof decoded === "object" &&
      ((decoded as Record<string, unknown>).connectionId === null ||
        typeof (decoded as Record<string, unknown>).connectionId === "string") &&
      ((decoded as Record<string, unknown>).sessionToken === null ||
        typeof (decoded as Record<string, unknown>).sessionToken === "string") &&
      typeof (decoded as Record<string, unknown>).nonce === "string"
    ) {
      return decoded as ParsedGmailOAuthState;
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
}): Promise<{ refreshToken: string; accessToken: string }> {
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
  const parsed = JSON.parse(response.bodyText) as { refresh_token?: string; access_token?: string };
  if (!parsed.refresh_token) throw new Error("NO_REFRESH_TOKEN");
  if (!parsed.access_token) throw new Error("NO_ACCESS_TOKEN");
  return { refreshToken: parsed.refresh_token, accessToken: parsed.access_token };
}

/**
 * Best-effort label for which Google account was just connected, so the
 * dashboard can show it instead of a bare "connected" badge. Uses
 * `users.getProfile`, already covered by the `gmail.readonly` scope this
 * connector requests -- no extra consent needed. Returns null on
 * any failure; a connection without a resolved label is still a working
 * connection, and this must never be the reason a connect attempt fails.
 */
export async function fetchGmailAccountEmail(
  accessToken: string,
  fetchImpl: (input: SafeFetchInput) => Promise<SafeFetchResult> = fetchWithOptionalFixture,
): Promise<string | null> {
  try {
    const response = await fetchImpl({
      url: new URL(`https://${gmailApiHostname()}/gmail/v1/users/me/profile`),
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      timeoutMs: 10_000,
    });
    if (Math.floor(response.status / 100) !== 2) return null;
    const parsed = JSON.parse(response.bodyText) as { emailAddress?: string };
    return parsed.emailAddress ?? null;
  } catch {
    return null;
  }
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
