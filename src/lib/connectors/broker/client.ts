import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { safeFetch, validateDestinationUrl } from "../custom-api/network-guard";

/**
 * The credential-broker protocol for Mode B ("reuse the application's
 * existing connection"): at execution time, Authority asks the
 * application's own registered endpoint for a short-lived access token
 * scoped to one pre-registered connection, uses it once, in memory, for the
 * approved connector call, and discards it. The broker URL is never
 * supplied by an agent or derived from a tool call -- it comes only from
 * `connection_brokers`, populated once by a tenant admin through the
 * dashboard -- and every call goes through the same SSRF-safe fetch
 * (`safeFetch`/`validateDestinationUrl`) Custom API's own tenant-supplied
 * base URL already uses: no redirects followed, destination IP re-resolved
 * and re-validated on every call, response size and timeout bounded.
 *
 * Request binding and replay protection: the body is signed with
 * HMAC-SHA256 over `timestamp + "." + nonce + "." + JSON.stringify(body)`,
 * using the shared secret established when the broker was registered. A
 * broker implementation is expected to reject a request whose timestamp is
 * outside a small window (this client sends one 60 seconds wide) or whose
 * nonce it has already seen -- see docs/connectors/broker.md for the full
 * protocol a broker must implement, including the exact response schema.
 */

export interface BrokerAccessToken {
  accessToken: string;
  expiresInSeconds: number;
}

export type BrokerTokenResult =
  { status: "ok"; token: BrokerAccessToken } | { status: "error"; reason: string };

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 8_192;

export async function requestBrokerAccessToken(input: {
  brokerUrl: string;
  brokerSecret: string;
  connectionId: string;
  connectorId: string;
  brokerConnectionRef: string;
}): Promise<BrokerTokenResult> {
  let url: URL;
  try {
    url = validateDestinationUrl(input.brokerUrl);
  } catch {
    return { status: "error", reason: "BROKER_URL_INVALID" };
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");
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

  let response;
  try {
    response = await safeFetch({
      url,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authority-timestamp": timestamp,
        "authority-nonce": nonce,
        "authority-signature": signature,
      },
      body,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  } catch {
    return { status: "error", reason: "BROKER_UNREACHABLE" };
  }

  if (response.truncated || response.bodyText.length > MAX_RESPONSE_BYTES) {
    return { status: "error", reason: "BROKER_RESPONSE_TOO_LARGE" };
  }
  if (Math.floor(response.status / 100) !== 2) {
    // `reason` ultimately becomes a connector_execution_receipts.reason_code
    // (checked as `^[A-Z_]{1,60}$` -- letters and underscores only), so the
    // raw numeric status can never be embedded directly, the same
    // constraint gmail/connector.ts's own execute() already respects for an
    // upstream Gmail API error (UPSTREAM_CLIENT_ERROR/UPSTREAM_SERVER_ERROR,
    // not the literal status code). Classifying by status class here keeps
    // every broker rejection able to actually be recorded as a receipt,
    // instead of silently failing to settle (a real failure found by
    // gmail-broker.test.ts: any non-2xx broker response previously produced
    // a reason code the database would reject on insert).
    const statusClass = Math.floor(response.status / 100);
    return {
      status: "error",
      reason: statusClass === 4 ? "BROKER_REJECTED" : "BROKER_UPSTREAM_ERROR",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    return { status: "error", reason: "BROKER_RESPONSE_MALFORMED" };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).accessToken !== "string" ||
    typeof (parsed as Record<string, unknown>).expiresInSeconds !== "number"
  ) {
    return { status: "error", reason: "BROKER_RESPONSE_MALFORMED" };
  }

  const { accessToken, expiresInSeconds } = parsed as { accessToken: string; expiresInSeconds: number };
  if (accessToken.length === 0 || expiresInSeconds <= 0) {
    return { status: "error", reason: "BROKER_RESPONSE_MALFORMED" };
  }

  return { status: "ok", token: { accessToken, expiresInSeconds } };
}
