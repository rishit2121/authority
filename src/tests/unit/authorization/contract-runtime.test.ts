import { describe, expect, it } from "vitest";

import { isContractCurrentlyActive } from "@/lib/authorization/contract-runtime";

const NOW = new Date("2026-09-26T12:00:00.000Z");

describe("isContractCurrentlyActive", () => {
  it("is false for any non-active status", () => {
    expect(isContractCurrentlyActive({ status: "proposed", expiresAt: undefined }, NOW)).toBe(false);
    expect(isContractCurrentlyActive({ status: "awaiting_approval", expiresAt: undefined }, NOW)).toBe(false);
    expect(isContractCurrentlyActive({ status: "rejected", expiresAt: undefined }, NOW)).toBe(false);
    expect(isContractCurrentlyActive({ status: "expired", expiresAt: undefined }, NOW)).toBe(false);
    expect(isContractCurrentlyActive({ status: "revoked", expiresAt: undefined }, NOW)).toBe(false);
    expect(isContractCurrentlyActive({ status: "superseded", expiresAt: undefined }, NOW)).toBe(false);
  });

  it("is true for active with no expiresAt at all", () => {
    expect(isContractCurrentlyActive({ status: "active", expiresAt: undefined }, NOW)).toBe(true);
  });

  it("is true for active with a future expiresAt", () => {
    expect(isContractCurrentlyActive({ status: "active", expiresAt: "2026-09-26T13:00:00.000Z" }, NOW)).toBe(
      true,
    );
  });

  it("is false for active with a past expiresAt, even though the stored status still says active", () => {
    expect(isContractCurrentlyActive({ status: "active", expiresAt: "2026-09-26T11:59:59.000Z" }, NOW)).toBe(
      false,
    );
  });

  it("is false exactly at the expiry instant (strictly greater-than, not greater-or-equal)", () => {
    expect(isContractCurrentlyActive({ status: "active", expiresAt: "2026-09-26T12:00:00.000Z" }, NOW)).toBe(
      false,
    );
  });

  it("defaults `now` to the real current time when omitted", () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    expect(isContractCurrentlyActive({ status: "active", expiresAt: farFuture })).toBe(true);
    const past = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    expect(isContractCurrentlyActive({ status: "active", expiresAt: past })).toBe(false);
  });
});
