import { describe, expect, it } from "vitest";

import {
  resolveCurrentTenant,
  TENANT_COOKIE_NAME,
  TENANT_COOKIE_OPTIONS,
  TENANT_ENVIRONMENT_LABELS,
  TENANT_ROLE_LABELS,
  validateWorkspaceSelection,
  type TenantMembership,
} from "@/lib/auth/tenant-context";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const TENANT_C = "33333333-3333-4333-8333-333333333333";

const northwind: TenantMembership = {
  tenantId: TENANT_A,
  name: "Northwind Labs",
  slug: "northwind-labs",
  environment: "development",
  role: "owner",
};

const globex: TenantMembership = {
  tenantId: TENANT_B,
  name: "Globex Payments",
  slug: "globex-payments",
  environment: "production",
  role: "viewer",
};

describe("resolveCurrentTenant", () => {
  it("returns null when the user belongs to no tenant, so onboarding can run", () => {
    expect(resolveCurrentTenant([], TENANT_A)).toBeNull();
    expect(resolveCurrentTenant([], null)).toBeNull();
  });

  it("selects the requested tenant when it is one of the user's memberships", () => {
    const resolution = resolveCurrentTenant([northwind, globex], TENANT_B);
    expect(resolution?.current).toEqual(globex);
    expect(resolution?.shouldPersist).toBe(false);
  });

  it("falls back to the first membership when no tenant is requested", () => {
    const resolution = resolveCurrentTenant([northwind, globex], null);
    expect(resolution?.current).toEqual(northwind);
    // Signals the caller to write the cookie so the choice sticks.
    expect(resolution?.shouldPersist).toBe(true);
  });

  // The security property: a cookie naming a tenant the user does not belong
  // to must grant nothing. It is ignored, not honoured and not an error.
  it("ignores a tenant the user is not a member of", () => {
    const resolution = resolveCurrentTenant([northwind], TENANT_B);
    expect(resolution?.current).toEqual(northwind);
    expect(resolution?.shouldPersist).toBe(true);
  });

  it("ignores a forged cookie value naming an unknown tenant", () => {
    const resolution = resolveCurrentTenant([northwind, globex], TENANT_C);
    expect(resolution?.current).toEqual(northwind);
    expect(resolution?.shouldPersist).toBe(true);
  });

  it("ignores a malformed cookie value without attempting a lookup", () => {
    for (const malformed of [
      "not-a-uuid",
      "",
      "   ",
      "'; drop table tenant_memberships; --",
      "11111111-1111-4111-8111",
      "../../etc/passwd",
      "<script>alert(1)</script>",
    ]) {
      const resolution = resolveCurrentTenant([northwind, globex], malformed);
      expect(resolution?.current).toEqual(northwind);
      expect(resolution?.shouldPersist).toBe(true);
    }
  });

  it("is deterministic across repeated resolutions, so the workspace does not drift", () => {
    const first = resolveCurrentTenant([northwind, globex], null);
    const second = resolveCurrentTenant([northwind, globex], null);
    expect(first?.current.tenantId).toBe(second?.current.tenantId);
  });

  it("carries the role from the membership rather than from the cookie", () => {
    const resolution = resolveCurrentTenant([northwind, globex], TENANT_B);
    expect(resolution?.current.role).toBe("viewer");
  });
});

describe("resolveCurrentTenant with co-member rows", () => {
  // Regression: the memberships SELECT policy intentionally exposes every
  // member of an accessible tenant so member administration can work. An
  // unfiltered query therefore returns one row per member, and a four-person
  // tenant rendered as four workspaces whose role was whichever row sorted
  // first. The fix is a user filter at the query; this pins the behaviour the
  // resolver must show once each tenant appears exactly once.
  it("treats each distinct tenant as one workspace carrying the caller's own role", () => {
    const callerRows: TenantMembership[] = [
      { ...northwind, role: "viewer" },
      { ...globex, role: "owner" },
    ];

    const resolution = resolveCurrentTenant(callerRows, TENANT_A);

    expect(resolution?.current.role).toBe("viewer");
    expect(callerRows.filter((m) => m.tenantId === TENANT_A)).toHaveLength(1);
  });

  it("picks the first row when duplicates for one tenant reach it, rather than mixing roles", () => {
    // Defensive: if duplicates ever arrive, resolution must still be
    // deterministic instead of role-shuffling between requests.
    const duplicated: TenantMembership[] = [
      { ...northwind, role: "viewer" },
      { ...northwind, role: "owner" },
    ];

    expect(resolveCurrentTenant(duplicated, TENANT_A)?.current.role).toBe("viewer");
    expect(resolveCurrentTenant(duplicated, TENANT_A)?.current.role).toBe("viewer");
  });
});

describe("validateWorkspaceSelection", () => {
  it("accepts a tenant the user belongs to", () => {
    expect(validateWorkspaceSelection([northwind, globex], TENANT_B)).toEqual({
      ok: true,
      tenantId: TENANT_B,
    });
  });

  // Unlike resolution, an explicit switch to a forbidden tenant is refused
  // rather than quietly redirected somewhere else.
  it("refuses a tenant the user does not belong to", () => {
    expect(validateWorkspaceSelection([northwind], TENANT_B)).toEqual({
      ok: false,
      reason: "not_a_member",
    });
  });

  it("refuses a malformed identifier", () => {
    for (const malformed of ["not-a-uuid", "", null, undefined, 42, {}, [], TENANT_A.slice(0, 10)]) {
      expect(validateWorkspaceSelection([northwind], malformed)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("refuses everything when the user has no memberships", () => {
    expect(validateWorkspaceSelection([], TENANT_A)).toEqual({ ok: false, reason: "not_a_member" });
  });
});

describe("tenant cookie", () => {
  // The cookie is a preference, not a credential. These options are what keep
  // it from being readable by scripts or sent on cross-site subrequests.
  it("is httpOnly and lax, scoped to the whole site", () => {
    expect(TENANT_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(TENANT_COOKIE_OPTIONS.sameSite).toBe("lax");
    expect(TENANT_COOKIE_OPTIONS.path).toBe("/");
  });

  it("has a stable name", () => {
    expect(TENANT_COOKIE_NAME).toBe("authority_tenant");
  });
});

describe("labels", () => {
  it("covers every role and environment, so none renders untitled", () => {
    expect(Object.keys(TENANT_ROLE_LABELS).sort()).toEqual(
      ["admin", "developer", "owner", "security_admin", "viewer"].sort(),
    );
    expect(Object.keys(TENANT_ENVIRONMENT_LABELS).sort()).toEqual(
      ["development", "production", "staging"].sort(),
    );
  });
});
