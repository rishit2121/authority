import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RepositoryError } from "@/lib/persistence/errors";
import { createSupabaseAgentRepository } from "@/lib/persistence/supabase/agent-repository";
import type { RepositoryContext } from "@/lib/persistence/context";

import { OWNER_A_EMAIL, OWNER_B_EMAIL, TENANT_A_ID, TENANT_B_ID, signInAs } from "../support";

describe("Supabase agent repository", () => {
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

  it("lists only the calling tenant's agents", async () => {
    const repo = createSupabaseAgentRepository(contextA);
    const agents = await repo.listByTenant(TENANT_A_ID);

    expect(agents.length).toBeGreaterThanOrEqual(2);
    expect(agents.every((agent) => agent.tenantId === TENANT_A_ID)).toBe(true);
    expect(agents.some((agent) => agent.name === "coding-agent-17")).toBe(true);
  });

  it("returns an empty array, not an error, for a tenant with no agents", async () => {
    const repo = createSupabaseAgentRepository(contextB);
    await expect(repo.listByTenant(TENANT_B_ID)).resolves.toEqual([]);
  });

  it("returns null for an id that doesn't exist, rather than throwing", async () => {
    const repo = createSupabaseAgentRepository(contextA);
    await expect(repo.findById("00000000-0000-4000-8000-000000000000")).resolves.toBeNull();
  });

  it("RLS returns zero rows for another tenant's agent by real id — not visible, not an error", async () => {
    const asA = createSupabaseAgentRepository(contextA);
    const agents = await asA.listByTenant(TENANT_A_ID);
    const realAgentId = agents[0]?.id;
    expect(realAgentId).toBeDefined();

    const asB = createSupabaseAgentRepository(contextB);
    await expect(asB.findById(realAgentId!)).resolves.toBeNull();
  });

  it("throws a typed RepositoryError, not a raw Supabase error, on a tenant mismatch", async () => {
    const repo = createSupabaseAgentRepository(contextA);

    await expect(repo.listByTenant(TENANT_B_ID)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RepositoryError);
      expect((error as RepositoryError).code).toBe("tenant_mismatch");
      return true;
    });
  });
});
