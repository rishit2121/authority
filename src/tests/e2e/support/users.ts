/**
 * Seeded development users, mirroring supabase/seed.sql.
 *
 * These accounts exist only in the development project, use the reserved
 * `.test` TLD, and share one fixture password. The password is not a secret:
 * it unlocks throwaway accounts in a development database. It is read from the
 * environment so a differently-seeded project can override it without editing
 * this file.
 */
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "Authority-Dev-2026!";

export const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
export const TENANT_B_ID = "22222222-2222-4222-8222-222222222222";

export interface SeededUser {
  email: string;
  displayName: string;
  initials: string;
  tenantName: string;
  roleLabel: string;
}

/** Owner of Northwind Labs (tenant A). */
export const OWNER_A: SeededUser = {
  email: "owner.a@authority.test",
  displayName: "Ada Owner",
  initials: "AO",
  tenantName: "Northwind Labs",
  roleLabel: "Owner",
};

/** Viewer in Northwind Labs — same tenant as OWNER_A, different role. */
export const VIEWER_A: SeededUser = {
  email: "viewer.a@authority.test",
  displayName: "Vera Viewer",
  initials: "VV",
  tenantName: "Northwind Labs",
  roleLabel: "Viewer",
};

/**
 * Admin in Northwind Labs, reserved for the sign-out test.
 *
 * Sign-out is destructive to a session, so it uses an account no other spec
 * depends on. Sharing one account across a sign-out test and a stored session
 * makes the suite order-dependent.
 */
export const ADMIN_A: SeededUser = {
  email: "admin.a@authority.test",
  displayName: "Amin Admin",
  initials: "AA",
  tenantName: "Northwind Labs",
  roleLabel: "Admin",
};

/** Owner of Globex Payments (tenant B) — a different tenant entirely. */
export const OWNER_B: SeededUser = {
  email: "owner.b@authority.test",
  displayName: "Bo Owner",
  initials: "BO",
  tenantName: "Globex Payments",
  roleLabel: "Owner",
};
