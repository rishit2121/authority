import { describe, expect, it } from "vitest";

import {
  cursorFilter,
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  encodeCursor,
  MAX_PAGE_LIMIT,
  resolveLimit,
} from "@/lib/persistence/keyset-pagination";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a valid cursor", () => {
    const state = { createdAt: "2026-01-01T00:00:00.000Z", id: "11111111-1111-4111-8111-111111111111" };
    expect(decodeCursor(encodeCursor(state))).toEqual(state);
  });

  it("returns null for an absent cursor rather than throwing", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  describe("rejects a forged or malformed cursor without throwing", () => {
    it("rejects a value that isn't base64url at all", () => {
      expect(decodeCursor("not valid base64url !!!")).toBeNull();
    });

    it("rejects base64url that doesn't decode to JSON", () => {
      expect(decodeCursor(Buffer.from("not json").toString("base64url"))).toBeNull();
    });

    it("rejects JSON missing createdAt or id", () => {
      expect(decodeCursor(Buffer.from(JSON.stringify({ id: "x" })).toString("base64url"))).toBeNull();
      expect(decodeCursor(Buffer.from(JSON.stringify({ createdAt: "x" })).toString("base64url"))).toBeNull();
    });

    it("rejects createdAt or id of the wrong type", () => {
      const badTypes = [
        { createdAt: 12345, id: "x" },
        { createdAt: "x", id: 12345 },
        { createdAt: null, id: "x" },
        { createdAt: "x", id: ["array"] },
      ];
      for (const payload of badTypes) {
        expect(decodeCursor(Buffer.from(JSON.stringify(payload)).toString("base64url"))).toBeNull();
      }
    });

    it("rejects a JSON array masquerading as a cursor", () => {
      expect(decodeCursor(Buffer.from(JSON.stringify(["a", "b"])).toString("base64url"))).toBeNull();
    });
  });

  it("does not throw on a cursor forged with attacker-controlled but well-typed values", () => {
    // Well-formed shape, hostile content — this must decode (it's not the
    // decoder's job to know what's a "valid" id or timestamp) but see the
    // cursorFilter/tenant-scoping tests below for why this can't escalate.
    const forged = { createdAt: "2099-12-31T23:59:59.999Z", id: "'; drop table tasks; --" };
    expect(decodeCursor(encodeCursor(forged))).toEqual(forged);
  });
});

describe("resolveLimit", () => {
  it("defaults when no limit is supplied", () => {
    expect(resolveLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
    expect(resolveLimit({})).toBe(DEFAULT_PAGE_LIMIT);
  });

  it("clamps to the maximum rather than honouring an oversized request", () => {
    expect(resolveLimit({ limit: 100_000 })).toBe(MAX_PAGE_LIMIT);
  });

  it("clamps to at least 1 rather than honouring a zero or negative request", () => {
    expect(resolveLimit({ limit: 0 })).toBe(1);
    expect(resolveLimit({ limit: -50 })).toBe(1);
  });

  it("honours an in-range request exactly", () => {
    expect(resolveLimit({ limit: 10 })).toBe(10);
  });
});

describe("cursorFilter", () => {
  it("builds a PostgREST OR-filter combining the strictly-earlier and tie-broken branches", () => {
    const filter = cursorFilter({ createdAt: "2026-01-01T00:00:00.000Z", id: "abc" });
    expect(filter).toBe(
      "created_at.lt.2026-01-01T00:00:00.000Z,and(created_at.eq.2026-01-01T00:00:00.000Z,id.lt.abc)",
    );
  });

  // The filter this produces is always appended to a query that already
  // carries `.eq("tenant_id", tenantId)` — see every listXPaged
  // implementation in lib/persistence/supabase/. PostgREST combines
  // sequential filter calls with AND, so this expression can only narrow
  // *which rows of the already tenant-scoped result* come back; it has no
  // syntax that could widen the query to another tenant_id. A forged cursor
  // therefore produces an empty or unusual page within the caller's own
  // tenant, never a cross-tenant row — this is a structural property of how
  // the filter is composed, not something the cursor's content could
  // override even if it wanted to.
  it("contains no reference to tenant_id, so it can only narrow an already tenant-scoped query", () => {
    const filter = cursorFilter({ createdAt: "2026-01-01T00:00:00.000Z", id: "attacker-controlled" });
    expect(filter).not.toContain("tenant_id");
  });
});
