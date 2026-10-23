import { describe, expect, it, vi } from "vitest";

import { isBlockedIp, resolveAndValidateHost } from "@/lib/connectors/custom-api/network-guard";
import { isBlockedPostgresHost, resolvePostgresHost } from "@/lib/connectors/postgres/network-guard";

/**
 * Equivalent spellings of the same prohibited address must be classified the same way. Both guards used to
 * compare strings by prefix, so an expanded, zero-padded or hex IPv4-mapped spelling of a blocked address, or an
 * address inside a blocked range that does not share its textual prefix (fe80::/10 includes fe90::), was allowed.
 */

const LOOPBACK_SPELLINGS = [
  "::1",
  "0:0:0:0:0:0:0:1",
  "0000:0000:0000:0000:0000:0000:0000:0001",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "0:0:0:0:0:ffff:7f00:1",
  "::127.0.0.1", // IPv4-compatible (deprecated ::/96)
  "::7f00:1",
  "[::1]",
  "[::ffff:7f00:1]",
];

const METADATA_SPELLINGS = [
  "169.254.169.254",
  "::ffff:169.254.169.254",
  "::ffff:a9fe:a9fe",
  "[::ffff:a9fe:a9fe]",
];

const LINK_LOCAL_V6 = ["fe80::1", "fe90::1", "febf:ffff::1", "FE80::1", "fe80::1%en0"];

describe("Custom API guard: equivalent spellings of prohibited addresses", () => {
  it.each([...LOOPBACK_SPELLINGS, ...METADATA_SPELLINGS, ...LINK_LOCAL_V6])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    "2001:0db8::1", // documentation, zero-padded
    "0064:ff9b::7f00:1", // NAT64 embedding 127.0.0.1, zero-padded
    "64:ff9b::808:808", // NAT64 can reach any embedded IPv4 destination
    "2002:7f00:1::", // 6to4 embedding 127.0.0.1
    "2001::1", // Teredo
    "fec0::1", // deprecated site-local
    "::ffff:10.0.0.1",
    "::ffff:a00:1", // 10.0.0.1, hex form
    "::ffff:c0a8:101", // 192.168.1.1, hex form
  ])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "2001:4860:4860::8888", "::ffff:8.8.8.8", "::ffff:808:808", "[2001:4860:4860::8888]"])(
    "still allows public %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it("rejects a hostname whose DNS answer is an equivalent loopback spelling", async () => {
    const dns = await import("node:dns/promises");
    const spy = vi
      .spyOn(dns.default, "lookup")
      .mockResolvedValue([{ address: "0:0:0:0:0:0:0:1", family: 6 }] as never);
    await expect(resolveAndValidateHost("rebind.example")).rejects.toMatchObject({
      code: "DESTINATION_NOT_ALLOWED",
    });
    spy.mockRestore();
  });
});

describe("PostgreSQL guard: equivalent spellings of prohibited addresses", () => {
  it.each([...LOOPBACK_SPELLINGS, ...METADATA_SPELLINGS, ...LINK_LOCAL_V6, "0.0.0.0", "::"])(
    "blocks %s",
    (ip) => {
      expect(isBlockedPostgresHost(ip)).toBe(true);
    },
  );

  it.each(["64:ff9b::7f00:1", "2002:7f00:1::", "64:ff9b::a9fe:a9fe"])(
    "blocks a transition address embedding a prohibited IPv4 (%s)",
    (ip) => {
      expect(isBlockedPostgresHost(ip)).toBe(true);
    },
  );

  it.each(["10.0.0.5", "192.168.1.20", "172.16.4.4", "fd00::5", "::ffff:10.0.0.5", "8.8.8.8"])(
    "still allows private or public database host %s",
    (ip) => {
      expect(isBlockedPostgresHost(ip)).toBe(false);
    },
  );
});

describe("PostgreSQL guard: the validated address is the one connected to", () => {
  it("returns the validated address so the client can connect to it, not re-resolve the hostname", async () => {
    const dns = await import("node:dns/promises");
    const spy = vi
      .spyOn(dns.default, "lookup")
      .mockResolvedValue([{ address: "10.0.0.7", family: 4 }] as never);
    const resolved = await resolvePostgresHost("db.internal.example");
    expect(resolved).toEqual({ address: "10.0.0.7", servername: "db.internal.example" });
    spy.mockRestore();
  });

  it("rejects the whole answer if any resolved address is prohibited", async () => {
    const dns = await import("node:dns/promises");
    const spy = vi.spyOn(dns.default, "lookup").mockResolvedValue([
      { address: "10.0.0.7", family: 4 },
      { address: "::ffff:7f00:1", family: 6 },
    ] as never);
    await expect(resolvePostgresHost("db.internal.example")).rejects.toMatchObject({
      code: "HOST_NOT_ALLOWED",
    });
    spy.mockRestore();
  });

  it("keeps an IP literal host as both address and no TLS servername", async () => {
    await expect(resolvePostgresHost("10.0.0.9")).resolves.toEqual({ address: "10.0.0.9", servername: null });
  });
});
