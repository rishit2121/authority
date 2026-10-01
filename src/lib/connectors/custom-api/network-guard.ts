import "server-only";

import type { LookupAddress } from "node:dns";
import dns from "node:dns/promises";
import net from "node:net";

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

/** IPv4 ranges that may never be a Custom API destination, as (network, prefixLength) pairs. */
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // includes the 169.254.169.254 cloud metadata endpoint
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return parts.reduce((acc, part) => acc * 256 + part, 0) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (ipv4ToInt(network) & mask);
  });
}

/** Blocked: loopback, unspecified, link-local, unique-local, multicast, documentation, NAT64. */
function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  // IPv4-mapped (::ffff:a.b.c.d) -- check the embedded IPv4 address too.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)
  if (normalized.startsWith("ff")) return true; // multicast
  if (normalized.startsWith("2001:db8:")) return true; // documentation
  if (normalized.startsWith("64:ff9b:")) return true; // NAT64 (may embed an IPv4 destination)
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not a recognizable IP literal at all -- fail closed
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
  if (url.protocol !== "https:") throw new NetworkGuardError("HTTPS_REQUIRED", "Only https:// destinations are allowed.");
  if (url.username || url.password) throw new NetworkGuardError("USERINFO_NOT_ALLOWED", "URL userinfo is not allowed.");
  const port = url.port ? Number(url.port) : 443;
  if (!ALLOWED_PORTS.has(port)) throw new NetworkGuardError("PORT_NOT_ALLOWED", "Only port 443 is allowed.");
  if (net.isIP(url.hostname) && isBlockedIp(url.hostname)) {
    throw new NetworkGuardError("DESTINATION_NOT_ALLOWED", "This destination is not reachable from a connector.");
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
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new NetworkGuardError("DESTINATION_NOT_ALLOWED", "This destination is not reachable from a connector.");
    return hostname;
  }
  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new NetworkGuardError("DNS_RESOLUTION_FAILED", "Could not resolve the destination host.");
  }
  if (addresses.length === 0) throw new NetworkGuardError("DNS_RESOLUTION_FAILED", "Could not resolve the destination host.");
  if (addresses.some((a) => isBlockedIp(a.address))) {
    throw new NetworkGuardError("DESTINATION_NOT_ALLOWED", "This destination is not reachable from a connector.");
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
