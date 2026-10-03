/**
 * A minimal, dependency-free reference implementation of the credential-
 * broker protocol documented at /docs/customer-connections -- for testing
 * Mode B end to end without a real external broker. Implements exactly what
 * that doc asks a real broker to: verify the HMAC-SHA256 signature over
 * `timestamp + "." + nonce + "." + body`, reject a timestamp outside a
 * window, reject an already-seen nonce, and respond with
 * `{ accessToken, expiresInSeconds }` for the requested connection.
 *
 * Returns a per-`brokerConnectionRef` token (`mock-access-token-for-<ref>`)
 * rather than one fixed string, specifically so a test can confirm Authority
 * sent the *correct* ref for the connection it's executing against -- not
 * just that some signed request arrived.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";

const WINDOW_SECONDS = 60;

export function startMockBrokerServer({ secret }) {
  const seenNonces = new Set();
  const requests = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const timestamp = req.headers["authority-timestamp"];
      const nonce = req.headers["authority-nonce"];
      const signature = req.headers["authority-signature"];
      requests.push({ timestamp, nonce, signature, body });

      const respond = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (typeof timestamp !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
        return respond(400, { error: "missing_auth_headers" });
      }

      const expected = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
      const expectedBuf = Buffer.from(expected, "hex");
      const gotBuf = Buffer.from(signature, "hex");
      const validSignature = expectedBuf.length === gotBuf.length && timingSafeEqual(expectedBuf, gotBuf);
      if (!validSignature) {
        return respond(401, { error: "invalid_signature" });
      }

      const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
      if (!Number.isFinite(age) || age > WINDOW_SECONDS) {
        return respond(401, { error: "timestamp_out_of_window" });
      }

      if (seenNonces.has(nonce)) {
        return respond(401, { error: "nonce_replayed" });
      }
      seenNonces.add(nonce);

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return respond(400, { error: "malformed_body" });
      }
      const ref = parsed.brokerConnectionRef;
      if (typeof ref !== "string" || ref.length === 0) {
        return respond(400, { error: "missing_broker_connection_ref" });
      }

      return respond(200, { accessToken: `mock-access-token-for-${ref}`, expiresInSeconds: 3600 });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        requests,
        seenNonces,
        stop: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
