import "server-only";

import dns from "node:dns/promises";
import net from "node:net";

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
 * This is a one-time check at connect time, not a per-call DNS-rebinding
 * guard the way `safeFetch` pins an IP for every single HTTP request:
 * the host here is admin-configured once, not supplied per-request by an
 * agent, and does not change between calls without the admin's own action --
 * a materially different trust level than Custom API's tenant-configured-but-
 * agent-triggered base URL.
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

function isBlockedIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this network"
  if (a === 169 && b === 254) return true; // link-local, includes 169.254.169.254
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (normalized.startsWith("fe80:")) return true; // link-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

export function isBlockedPostgresHost(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not a recognizable IP literal at all -- fail closed
}

/** Resolves and validates a connection's configured host, once, at connection-configuration time. */
export async function validatePostgresHost(host: string): Promise<void> {
  if (host.length === 0 || host.length > 255) {
    throw new PostgresNetworkGuardError("INVALID_HOST", "Host must be 1-255 characters.");
  }
  const literalFamily = net.isIP(host);
  if (literalFamily !== 0) {
    if (isBlockedPostgresHost(host)) {
      throw new PostgresNetworkGuardError("HOST_NOT_ALLOWED", "This host is not allowed.");
    }
    return;
  }
  let addresses: string[];
  try {
    addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new PostgresNetworkGuardError("HOST_NOT_RESOLVABLE", "This host could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(isBlockedPostgresHost)) {
    throw new PostgresNetworkGuardError("HOST_NOT_ALLOWED", "This host is not allowed.");
  }
}
