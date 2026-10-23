import "server-only";

import type { LookupAddress } from "node:dns";
import dns from "node:dns/promises";
import net from "node:net";

import { createIpMatcher, parseIpLiteral } from "../shared/ip-ranges";

/**
 * SSRF protections for the Custom API connector (Phase 5 of the
 * agent-integration roadmap). A tenant's registered base URL is validated at
 * connection-configuration time (`validateDestination`); the resolved IP is
 * re-validated and pinned at every single request (`safeFetch`), since the
 * host a connection was configured against yesterday can resolve somewhere
 * else today (DNS rebinding) — trusting a hostname once is not enough.
 */

export class NetworkGuardError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NetworkGuardError";
  }
}

const ALLOWED_PORTS = new Set([443]);
const MAX_RESPONSE_BYTES = 1_048_576;
const CONNECT_TIMEOUT_MS = 5_000;
const RESPONSE_TIMEOUT_MS = 10_000;

/**
 * Ranges that may never be a Custom API destination. Matched by binary value (shared/ip-ranges.ts), so every
 * spelling of an address is classified the same way, and each IPv4 range is also refused when embedded in an
 * IPv4-mapped, IPv4-compatible, NAT64 or 6to4 IPv6 address.
 */
const isBlockedParsed = createIpMatcher(
  [
    { network: "0.0.0.0", prefix: 8 },
    { network: "10.0.0.0", prefix: 8 },
    { network: "100.64.0.0", prefix: 10 },
    { network: "127.0.0.0", prefix: 8 },
    { network: "169.254.0.0", prefix: 16 }, // includes the 169.254.169.254 cloud metadata endpoint
    { network: "172.16.0.0", prefix: 12 },
    { network: "192.0.0.0", prefix: 24 },
    { network: "192.0.2.0", prefix: 24 },
    { network: "192.88.99.0", prefix: 24 }, // 6to4 relay anycast
    { network: "192.168.0.0", prefix: 16 },
    { network: "198.18.0.0", prefix: 15 },
    { network: "198.51.100.0", prefix: 24 },
    { network: "203.0.113.0", prefix: 24 },
    { network: "224.0.0.0", prefix: 4 },
    { network: "240.0.0.0", prefix: 4 },
    { network: "255.255.255.255", prefix: 32 },
  ],
  [
    { network: "::", prefix: 96 }, // unspecified, loopback and the deprecated IPv4-compatible block
    { network: "64:ff9b::", prefix: 96 }, // NAT64 well-known prefix: can reach any embedded IPv4 destination
    { network: "64:ff9b:1::", prefix: 48 }, // NAT64 local-use prefix
    { network: "100::", prefix: 64 }, // discard-only
    { network: "2001::", prefix: 32 }, // Teredo
    { network: "2001:db8::", prefix: 32 }, // documentation
    { network: "2002::", prefix: 16 }, // 6to4: can reach any embedded IPv4 destination
    { network: "3fff::", prefix: 20 }, // documentation (RFC 9637)
    { network: "fc00::", prefix: 7 }, // unique local
    { network: "fe80::", prefix: 10 }, // link-local
    { network: "fec0::", prefix: 10 }, // deprecated site-local
    { network: "ff00::", prefix: 8 }, // multicast
  ],
);

export function isBlockedIp(ip: string): boolean {
  const parsed = parseIpLiteral(ip);
  if (!parsed) return true; // not a recognizable IP literal at all -- fail closed
  return isBlockedParsed(parsed);
}

/**
 * Structural validation of a connection's configured base URL — run once,
 * at connection-configuration time. HTTPS only, no userinfo, an allowed
 * port, and a hostname that is not itself a blocked IP literal. Does NOT
 * resolve DNS (the base URL's host may not even be resolvable from this
 * environment at configuration time) — that happens per-request instead.
 */
export function validateDestinationUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NetworkGuardError("INVALID_URL", "Not a valid URL.");
  }
  if (url.protocol !== "https:")
    throw new NetworkGuardError("HTTPS_REQUIRED", "Only https:// destinations are allowed.");
  if (url.username || url.password)
    throw new NetworkGuardError("USERINFO_NOT_ALLOWED", "URL userinfo is not allowed.");
  const port = url.port ? Number(url.port) : 443;
  if (!ALLOWED_PORTS.has(port)) throw new NetworkGuardError("PORT_NOT_ALLOWED", "Only port 443 is allowed.");
  // `url.hostname` keeps the brackets of an IPv6 literal ("[::1]"); parseIpLiteral accepts them.
  if (parseIpLiteral(url.hostname) && isBlockedIp(url.hostname)) {
    throw new NetworkGuardError(
      "DESTINATION_NOT_ALLOWED",
      "This destination is not reachable from a connector.",
    );
  }
  return url;
}

/**
 * Resolves a hostname and validates every returned address — IPv4 and
 * IPv6 — rejecting the whole result if even one candidate is private,
 * loopback, link-local, or a metadata address. Re-run on every request
 * (not cached across requests) specifically to resist DNS rebinding: a
 * hostname that resolved safely a minute ago is re-checked, not trusted.
 */
export async function resolveAndValidateHost(hostname: string): Promise<string> {
  const literal = parseIpLiteral(hostname);
  if (literal) {
    if (isBlockedIp(literal.address))
      throw new NetworkGuardError(
        "DESTINATION_NOT_ALLOWED",
        "This destination is not reachable from a connector.",
      );
    return literal.address;
  }
  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new NetworkGuardError("DNS_RESOLUTION_FAILED", "Could not resolve the destination host.");
  }
  if (addresses.length === 0)
    throw new NetworkGuardError("DNS_RESOLUTION_FAILED", "Could not resolve the destination host.");
  if (addresses.some((a) => isBlockedIp(a.address))) {
    throw new NetworkGuardError(
      "DESTINATION_NOT_ALLOWED",
      "This destination is not reachable from a connector.",
    );
  }
  // Pin to the first validated address for this request, rather than letting
  // the HTTP client re-resolve DNS at connect time (the actual rebinding
  // window: validated here, used there, moments apart).
  return addresses[0].address;
}

export interface SafeFetchResult {
  status: number;
  headers: Headers;
  bodyText: string;
  truncated: boolean;
}

export interface SafeFetchInput {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Bounds both connect and response time for this call; defaults to this module's own constants. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * The only function in this connector that is allowed to make a network
 * call. Validates and pins the destination, forbids redirects outright
 * (a redirect to an internal address would otherwise bypass every check
 * above), and bounds both time and response size.
 */
export async function safeFetch(input: SafeFetchInput): Promise<SafeFetchResult> {
  validateDestinationUrl(input.url.toString());
  const pinnedIp = await resolveAndValidateHost(input.url.hostname);

  const { Agent, request } = await import("undici");
  const agent = new Agent({
    connect: {
      // Pin the connection to the address we just validated, regardless of
      // what the hostname resolves to by the time the socket actually opens.
      lookup: (_hostname, _options, callback) => {
        callback(null, [{ address: pinnedIp, family: net.isIP(pinnedIp) as 4 | 6 }]);
      },
      timeout: input.timeoutMs ?? CONNECT_TIMEOUT_MS,
    },
  });

  try {
    const response = await request(input.url, {
      method: input.method as never,
      headers: input.headers,
      body: input.body,
      dispatcher: agent,
      signal: input.signal,
      // undici's base `request()` never auto-follows a redirect regardless of
      // this option existing elsewhere in its API; the 3xx check below is
      // what actually rejects one.
      headersTimeout: input.timeoutMs ?? RESPONSE_TIMEOUT_MS,
      bodyTimeout: input.timeoutMs ?? RESPONSE_TIMEOUT_MS,
    });

    if (response.statusCode >= 300 && response.statusCode < 400) {
      throw new NetworkGuardError("REDIRECT_REJECTED", "Redirects are not followed.");
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) {
        truncated = true;
        break;
      }
      chunks.push(chunk as Buffer);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    return {
      status: response.statusCode,
      headers,
      bodyText: Buffer.concat(chunks).toString("utf8"),
      truncated,
    };
  } finally {
    await agent.close();
  }
}
