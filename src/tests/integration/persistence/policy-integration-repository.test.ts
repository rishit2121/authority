import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RepositoryError } from "@/lib/persistence/errors";
import { createSupabaseIntegrationRepository } from "@/lib/persistence/supabase/integration-repository";
import { createSupabasePolicyRepository } from "@/lib/persistence/supabase/policy-repository";
import type { RepositoryContext } from "@/lib/persistence/context";

import { OWNER_A_EMAIL, OWNER_B_EMAIL, TENANT_A_ID, TENANT_B_ID, signInAs } from "../support";

describe("Supabase policy and integration repositories", () => {
  let contextA: RepositoryContext;
  let contextB: RepositoryContext;

  beforeAll(async () => {
    contextA = (await signInAs(OWNER_A_EMAIL, TENANT_A_ID)).context;
    contextB = (await signInAs(OWNER_B_EMAIL, TENANT_B_ID)).context;
  });

  afterAll(async () => {
    await contextA.supabase.auth.signOut();
    await contextB.supabase.auth.signOut();
  });

  describe("policies", () => {
    it("lists both the active and the draft demo policy for the tenant", async () => {
      const repo = createSupabasePolicyRepository(contextA);
      const policies = await repo.listByTenant(TENANT_A_ID);

      expect(policies.some((policy) => policy.status === "active")).toBe(true);
      expect(policies.some((policy) => policy.status === "draft")).toBe(true);
      expect(policies.every((policy) => policy.tenantId === TENANT_A_ID)).toBe(true);
    });

    it("returns an empty array for a tenant with no policies", async () => {
      const repo = createSupabasePolicyRepository(contextB);
      await expect(repo.listByTenant(TENANT_B_ID)).resolves.toEqual([]);
    });

    it("throws a typed error on a tenant mismatch rather than a raw Supabase error", async () => {
      const repo = createSupabasePolicyRepository(contextA);
      await expect(repo.listByTenant(TENANT_B_ID)).rejects.toBeInstanceOf(RepositoryError);
    });
  });

  describe("integrations", () => {
    it("lists the five demo integrations with no credential field on any of them", async () => {
      const repo = createSupabaseIntegrationRepository(contextA);
      const integrations = await repo.listByTenant(TENANT_A_ID);

      expect(integrations.length).toBeGreaterThanOrEqual(5);
      for (const integration of integrations) {
        expect(Object.keys(integration)).not.toContain("token");
        expect(Object.keys(integration)).not.toContain("credential");
        expect(Object.keys(integration)).not.toContain("secret");
      }
    });

    it("returns an empty array for a tenant with no integrations", async () => {
      const repo = createSupabaseIntegrationRepository(contextB);
      await expect(repo.listByTenant(TENANT_B_ID)).resolves.toEqual([]);
    });
  });
});
