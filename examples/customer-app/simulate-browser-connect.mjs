/**
 * Stands in for the real browser in `GET /connect/{token}` -> embedded
 * callback -> redirect back, so this example is runnable without a browser
 * at all. Only works against an Authority deployment running with
 * `GMAIL_FIXTURE_MODE=1` (see ../../src/lib/connectors/gmail/fixture-mode.ts)
 * -- in fixture mode there is no real external consent screen; the
 * "authorize URL" Authority generates already points straight back at its
 * own callback with a fixture code attached, so a plain HTTP client can
 * walk the whole chain exactly the way a browser would, carrying the
 * httpOnly state/PKCE cookies across the one redirect that needs them.
 *
 * This is scaffolding for the example, not something a real integration
 * ever needs -- a real browser does this automatically, against the real
 * provider's own consent screen.
 */

function parseSetCookies(headers) {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return raw.map((entry) => entry.split(";")[0]).join("; ");
}

export async function simulateEmbeddedConnect(connectUrl) {
  const first = await fetch(connectUrl, { redirect: "manual" });
  if (first.status < 300 || first.status >= 400) {
    throw new Error(`simulateEmbeddedConnect: expected a redirect from /connect, got ${first.status}`);
  }
  const cookieHeader = parseSetCookies(first.headers);
  // In fixture mode, startGmailOAuth's "authorize URL" is already Authority's
  // own embedded callback with a fixture code attached -- there is no real
  // external consent screen to visit, so this one hop carries the state/
  // PKCE cookies straight to the callback that needs them.
  const callbackUrl = first.headers.get("location");
  if (!callbackUrl) throw new Error("simulateEmbeddedConnect: no redirect location from /connect");

  const second = await fetch(callbackUrl, {
    redirect: "manual",
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  if (second.status < 300 || second.status >= 400) {
    const body = await second.text().catch(() => "");
    throw new Error(
      `simulateEmbeddedConnect: expected a redirect from the embedded callback, got ${second.status} ${body}`,
    );
  }
  const finalLocation = second.headers.get("location");
  if (!finalLocation) throw new Error("simulateEmbeddedConnect: no final redirect location");

  const url = new URL(finalLocation);
  if (url.pathname === "/connect/error") {
    throw new Error(`simulateEmbeddedConnect: connection failed (${url.searchParams.get("reason")})`);
  }
  return { returnUrl: finalLocation, connectionSessionId: url.searchParams.get("connection_session_id") };
}
