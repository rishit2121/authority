import "server-only";

import dns from "node:dns/promises";

import { createIpMatcher, parseIpLiteral } from "../shared/ip-ranges";

/**
 * A deliberately much narrower guard than Custom API's
 * (../custom-api/network-guard.ts). Custom API's threat model is "this
 * destination could be anything, including an attacker steering a tenant
 * admin toward internal infrastructure" -- so it blocks every private/
 * loopback/link-local range outright. A Postgres connection inverts that
 * assumption: the whole point of this connector is reaching a tenant's own
 * database, which is overwhelmingly likely to sit on a private network
 * (a VPC-internal RDS instance, a private Postgres box) -- blocking
 * RFC1918 ranges here would make the connector useless for its primary use
 * case. What this guard still blocks, unconditionally: the cloud metadata
 * endpoint and loopback, so a malicious or compromised admin cannot point
 * this connector at the gateway process's own host or its cloud instance's
 * credential-vending endpoint. Normal private ranges are allowed.
 *
 * The host is admin-configured, not supplied per call by an agent, but its DNS answer can still change between
 * validation and connection. `resolvePostgresHost` therefore returns the validated address, and the client
 * connects to that address rather than re-resolving the hostname (the hostname is kept for TLS verification).
 * Addresses are classified by binary value (../shared/ip-ranges.ts), so equivalent spellings such as
 * `0:0:0:0:0:0:0:1` or `::ffff:7f00:1`, and transition addresses embedding a blocked IPv4, are refused too.
 */

export class PostgresNetworkGuardError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PostgresNetworkGuardError";
  }
}

/** Loopback, "this network" and link-local (including 169.254.169.254), in every IPv4/IPv6 form. Private ranges stay allowed. */
const isBlockedParsed = createIpMatcher(
  [
    { network: "0.0.0.0", prefix: 8 },
    { network: "127.0.0.0", prefix: 8 },
    { network: "169.254.0.0", prefix: 16 },
  ],
  [
    { network: "::", prefix: 128 },
    { network: "::1", prefix: 128 },
    { network: "fe80::", prefix: 10 },
  ],
);

export function isBlockedPostgresHost(ip: string): boolean {
  const parsed = parseIpLiteral(ip);
  if (!parsed) return true; // not a recognizable IP literal at all -- fail closed
  return isBlockedParsed(parsed);
}

export interface ResolvedPostgresHost {
  /** The validated address the client must connect to. */
  address: string;
  /** The configured hostname, for TLS certificate verification; null when the host is an IP literal. */
  servername: string | null;
}

/**
 * Validates a configured host and returns the address to connect to. A hostname is resolved once, every answer
 * is checked, and the first answer is returned so the connection uses exactly the address that was validated.
 */
export async function resolvePostgresHost(host: string): Promise<ResolvedPostgresHost> {
  if (host.length === 0 || host.length > 255) {
    throw new PostgresNetworkGuardError("INVALID_HOST", "Host must be 1-255 characters.");
  }
  const literal = parseIpLiteral(host);
  if (literal) {
    if (isBlockedParsed(literal)) {
      throw new PostgresNetworkGuardError("HOST_NOT_ALLOWED", "This host is not allowed.");
    }
    return { address: literal.address, servername: null };
  }
  let addresses: string[];
  try {
    addresses = (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    throw new PostgresNetworkGuardError("HOST_NOT_RESOLVABLE", "This host could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(isBlockedPostgresHost)) {
    throw new PostgresNetworkGuardError("HOST_NOT_ALLOWED", "This host is not allowed.");
  }
  return { address: addresses[0], servername: host };
}

/** Validates a connection's configured host at connection-configuration time. */
export async function validatePostgresHost(host: string): Promise<void> {
  await resolvePostgresHost(host);
}
