import "server-only";

import net from "node:net";

/**
 * Address classification shared by the connector network guards.
 *
 * Classification is by parsed binary value (Node's `net.BlockList`, which accepts every IPv6 spelling:
 * compressed, expanded, zero-padded, dotted-quad tail), never by comparing strings. A prefix comparison misses
 * equivalent spellings of one address (`0:0:0:0:0:0:0:1` is `::1`, `::ffff:7f00:1` is `::ffff:127.0.0.1`) and
 * addresses inside a range that do not share its textual prefix (`fe90::1` is in `fe80::/10`).
 *
 * An IPv4 range given to {@link createIpMatcher} also matches that range embedded in IPv6:
 *   - IPv4-mapped `::ffff:a.b.c.d` (BlockList applies IPv4 rules to these natively),
 *   - IPv4-compatible `::a.b.c.d` (deprecated, ::/96),
 *   - NAT64 well-known prefix `64:ff9b::a.b.c.d` (RFC 6052),
 *   - 6to4 `2002:AABB:CCDD::/48` (RFC 3056).
 * A guard that must refuse those transition mechanisms entirely lists their whole IPv6 prefix as well.
 */

export interface ParsedIp {
  address: string;
  family: 4 | 6;
}

export interface Cidr {
  network: string;
  prefix: number;
}

/** An IP literal, accepting URL brackets (`[::1]`) and dropping an IPv6 zone index (`fe80::1%en0`). Null if not an IP. */
export function parseIpLiteral(raw: string): ParsedIp | null {
  let value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  const family = net.isIP(value);
  if (family === 0) return null;
  return { address: value, family: family as 4 | 6 };
}

function sixToFourPrefix(ipv4: string): string {
  const [a, b, c, d] = ipv4.split(".").map(Number);
  const hex = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
  return `2002:${hex(a, b)}:${hex(c, d)}::`;
}

/** A predicate over parsed addresses, built once from CIDR lists. */
export function createIpMatcher(ipv4: readonly Cidr[], ipv6: readonly Cidr[]): (ip: ParsedIp) => boolean {
  const list = new net.BlockList();
  for (const { network, prefix } of ipv4) {
    list.addSubnet(network, prefix, "ipv4");
    list.addSubnet(`::${network}`, 96 + prefix, "ipv6");
    list.addSubnet(`64:ff9b::${network}`, 96 + prefix, "ipv6");
    list.addSubnet(sixToFourPrefix(network), 16 + prefix, "ipv6");
  }
  for (const { network, prefix } of ipv6) list.addSubnet(network, prefix, "ipv6");
  return (ip) => list.check(ip.address, ip.family === 4 ? "ipv4" : "ipv6");
}
