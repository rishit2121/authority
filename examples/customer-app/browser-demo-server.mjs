import http from "node:http";

import { createBackendClient } from "./backend-client.mjs";

/**
 * A minimal, real web server standing in for Acme's own customer-facing
 * app -- for a REAL browser (not a plain fetch client, see
 * simulate-browser-connect.mjs) to literally start on, click through, and
 * land back on. Models exactly what a real integration's backend does: it
 * creates/resolves the signed-in end user as an Authority customer and
 * opens a connection session SERVER-SIDE (the backend credential never
 * reaches the browser), then redirects the browser to the connect URL
 * Authority returned. The browser itself only ever sees three things: this
 * app's own pages, Authority's `/connect/{token}` and (behind it, invisible
 * in fixture mode) Google's consent screen, and this app's own return page.
 *
 * `POST /api/v1/connections/sessions`'s own `url` field is a path
 * (`/connect/{token}`), not an absolute URL (see that route's own
 * comment) -- joined against `authorityBaseUrl` here before redirecting.
 */
export function startBrowserDemoServer({ authorityBaseUrl, backendKey, externalId = "alex" }) {
  const client = createBackendClient({ baseUrl: authorityBaseUrl, backendKey });
  let port;
  let returnUrl;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const html = (body) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body>${body}</body></html>`);
    };

    if (url.pathname === "/") {
      return html(`
        <h1>Acme account settings</h1>
        <p>Connect your Gmail account so Acme's agent can act on your behalf.</p>
        <a href="/start-connect" id="connect-gmail">Connect Gmail</a>
      `);
    }

    if (url.pathname === "/start-connect") {
      try {
        const customer = await client.createOrResolveCustomer(externalId);
        const session = await client.createConnectionSession(customer.customerId, "gmail", returnUrl);
        res.writeHead(302, { location: new URL(session.url, authorityBaseUrl).toString() });
        return res.end();
      } catch (error) {
        return html(`<h1>Could not start the connection</h1><p>${String(error)}</p>`);
      }
    }

    if (url.pathname === "/connected") {
      const sessionId = url.searchParams.get("connection_session_id");
      try {
        const status = await client.connectionSessionStatus(sessionId);
        if (status.status === "completed") {
          return html(`<h1>Gmail connected</h1><p data-testid="connection-id">${status.connectionId}</p>`);
        }
        return html(`<h1>Connection not completed</h1><p>${status.status}</p>`);
      } catch (error) {
        return html(`<h1>Could not confirm the connection</h1><p>${String(error)}</p>`);
      }
    }

    res.writeHead(404);
    res.end("Not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      returnUrl = `http://127.0.0.1:${port}/connected`;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        returnUrl,
        stop: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
