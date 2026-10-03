import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";

/**
 * A minimal, real HTTP implementation of the credential-broker protocol
 * documented at /docs/customer-connections -- for exercising Mode B
 * end to end in tests without a real external broker. Verifies the
 * HMAC-SHA256 signature over `timestamp + "." + nonce + "." + body`,
 * rejects a timestamp outside a window, rejects an already-seen nonce, and
 * responds with a per-`brokerConnectionRef` token so a test can confirm
 * Authority sent the *correct* ref for the connection it executed against.
 * The plain-JS twin of this (examples/customer-app/mock-broker-server.mjs)
 * is for the runnable example; kept separate rather than shared across the
 * ESM-example/TS-test boundary.
 */

const WINDOW_SECONDS = 60;

export interface MockBrokerRequest {
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
  body: string;
}

export interface MockBrokerServer {
  url: string;
  requests: MockBrokerRequest[];
  stop: () => Promise<void>;
}

export function startMockBrokerServer(options: {
  secret: string;
  /** Overrides the accepted timestamp window, for testing rejection of a stale request. */
  windowSeconds?: number;
  /** Always answers with this HTTP status/body instead of the real protocol -- for testing how a rejection surfaces. */
  forceResponse?: { status: number; body: unknown };
}): Promise<MockBrokerServer> {
  const window = options.windowSeconds ?? WINDOW_SECONDS;
  const seenNonces = new Set<string>();
  const requests: MockBrokerRequest[] = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
    });
    req.on("end", () => {
      const timestamp = asHeader(req.headers["authority-timestamp"]);
      const nonce = asHeader(req.headers["authority-nonce"]);
      const signature = asHeader(req.headers["authority-signature"]);
      requests.push({ timestamp, nonce, signature, body });

      const respond = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (options.forceResponse) {
        return respond(options.forceResponse.status, options.forceResponse.body);
      }

      if (!timestamp || !nonce || !signature) {
        return respond(400, { error: "missing_auth_headers" });
      }

      const expected = createHmac("sha256", options.secret)
        .update(`${timestamp}.${nonce}.${body}`)
        .digest("hex");
      const expectedBuf = Buffer.from(expected, "hex");
      const gotBuf = Buffer.from(signature, "hex");
      const validSignature = expectedBuf.length === gotBuf.length && timingSafeEqual(expectedBuf, gotBuf);
      if (!validSignature) {
        return respond(401, { error: "invalid_signature" });
      }

      const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
      if (!Number.isFinite(age) || age > window) {
        return respond(401, { error: "timestamp_out_of_window" });
      }

      if (seenNonces.has(nonce)) {
        return respond(401, { error: "nonce_replayed" });
      }
      seenNonces.add(nonce);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return respond(400, { error: "malformed_body" });
      }
      const ref =
        parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).brokerConnectionRef : null;
      if (typeof ref !== "string" || ref.length === 0) {
        return respond(400, { error: "missing_broker_connection_ref" });
      }

      return respond(200, { accessToken: `mock-access-token-for-${ref}`, expiresInSeconds: 3600 });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        requests,
        stop: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function asHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type TestBrokerTokenResult =
  | { status: "ok"; token: { accessToken: string; expiresInSeconds: number } }
  | { status: "error"; reason: string };

/**
 * A test-only stand-in for the real `requestBrokerAccessToken`
 * (src/lib/connectors/broker/client.ts), implementing the identical signing
 * protocol (HMAC-SHA256 over `timestamp.nonce.body`, same headers, same
 * request/response shape) but calling plain `fetch` instead of `safeFetch`.
 *
 * The real client's `safeFetch`/`validateDestinationUrl` deliberately
 * refuses any non-HTTPS, non-port-443, or loopback/private destination --
 * exactly the SSRF protection a tenant-registered broker URL needs in
 * production, and not something this test should touch or weaken. That
 * same restriction makes it impossible to point the real client at an
 * in-process `http://127.0.0.1` mock broker, so this test substitutes this
 * protocol-identical client via the Gmail connector's own
 * `requestBrokerToken` dependency-injection seam, for this test only. The
 * production code path (`gmail/connector.ts`'s `defaultGmailConnectorDeps`)
 * is untouched. A separate assertion (gmail-broker.test.ts) exercises the
 * real client directly to confirm it still refuses exactly such a URL.
 */
export async function requestTestBrokerAccessToken(input: {
  brokerUrl: string;
  brokerSecret: string;
  connectionId: string;
  connectorId: string;
  brokerConnectionRef: string;
  /** Test-only: pins the nonce instead of generating a fresh one, to exercise replay rejection. */
  nonceOverride?: string;
}): Promise<TestBrokerTokenResult> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = input.nonceOverride ?? randomBytes(16).toString("hex");
  const body = JSON.stringify({
    connectionId: input.connectionId,
    connectorId: input.connectorId,
    brokerConnectionRef: input.brokerConnectionRef,
    timestamp,
    nonce,
  });
  const signature = createHmac("sha256", input.brokerSecret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");

  // connection_brokers.url carries a DB-level check that it starts with
  // "https://" (the same shape a real production broker URL must have, and
  // not something this test should weaken) -- so the fixture row stores an
  // https:// URL for this same loopback address/port. This test-only client
  // rewrites it back to http:// here, since the in-process mock server
  // speaks plain HTTP; the signing/response logic above is unchanged either
  // way, so this does not loosen anything the test is actually checking.
  const dispatchUrl = input.brokerUrl.replace(/^https:\/\//, "http://");

  let response: Response;
  try {
    response = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authority-timestamp": timestamp,
        "authority-nonce": nonce,
        "authority-signature": signature,
      },
      body,
    });
  } catch {
    return { status: "error", reason: "BROKER_UNREACHABLE" };
  }
  if (Math.floor(response.status / 100) !== 2) {
    // Mirrors the real requestBrokerAccessToken's own fix (broker/client.ts):
    // `reason` ends up as a connector_execution_receipts.reason_code, which
    // the database only accepts as `^[A-Z_]{1,60}$` -- no digits -- so the
    // raw status code can't be embedded directly. Classifying by status
    // class instead keeps this test double protocol-identical to production.
    const statusClass = Math.floor(response.status / 100);
    return { status: "error", reason: statusClass === 4 ? "BROKER_REJECTED" : "BROKER_UPSTREAM_ERROR" };
  }
  const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!parsed || typeof parsed.accessToken !== "string" || typeof parsed.expiresInSeconds !== "number") {
    return { status: "error", reason: "BROKER_RESPONSE_MALFORMED" };
  }
  return {
    status: "ok",
    token: { accessToken: parsed.accessToken, expiresInSeconds: parsed.expiresInSeconds },
  };
}
