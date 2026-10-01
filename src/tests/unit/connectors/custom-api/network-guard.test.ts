import { describe, expect, it } from "vitest";

import { NetworkGuardError, isBlockedIp, validateDestinationUrl } from "@/lib/connectors/custom-api/network-guard";

describe("isBlockedIp", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
  ])("blocks IPv4 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.0"])(
    "allows public IPv4 %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it.each(["::1", "::", "fe80::1", "fc00::1", "fd00::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"])(
    "blocks IPv6 %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    },
  );

  it.each(["2001:4860:4860::8888", "::ffff:8.8.8.8"])("allows public IPv6 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it("fails closed for a non-IP string", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });
});

describe("validateDestinationUrl", () => {
  it("accepts a plain https URL", () => {
    expect(() => validateDestinationUrl("https://api.example.com/v1/orders")).not.toThrow();
  });

  it("rejects non-https schemes", () => {
    expect(() => validateDestinationUrl("http://api.example.com")).toThrow(NetworkGuardError);
    expect(() => validateDestinationUrl("ftp://api.example.com")).toThrow(NetworkGuardError);
  });

  it("rejects userinfo in the URL", () => {
    expect(() => validateDestinationUrl("https://user:pass@api.example.com")).toThrow(NetworkGuardError);
  });

  it("rejects a non-443 port", () => {
    expect(() => validateDestinationUrl("https://api.example.com:8443")).toThrow(NetworkGuardError);
  });

  it("rejects a literal private/loopback/metadata IP as the host", () => {
    expect(() => validateDestinationUrl("https://127.0.0.1/x")).toThrow(NetworkGuardError);
    expect(() => validateDestinationUrl("https://169.254.169.254/latest/meta-data")).toThrow(NetworkGuardError);
    expect(() => validateDestinationUrl("https://10.0.0.5/x")).toThrow(NetworkGuardError);
  });

  it("rejects a malformed URL", () => {
    expect(() => validateDestinationUrl("not a url")).toThrow(NetworkGuardError);
  });
});
