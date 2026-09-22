import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSupabaseTaskRepository } from "@/lib/persistence/supabase/task-repository";
import type { RepositoryContext } from "@/lib/persistence/context";

import { OWNER_A_EMAIL, OWNER_B_EMAIL, TENANT_A_ID, TENANT_B_ID, signInAs } from "../support";

describe("Supabase task repository", () => {
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

  it("lists only the calling tenant's tasks, most recent first", async () => {
    const repo = createSupabaseTaskRepository(contextA);
    const tasks = await repo.listByTenant(TENANT_A_ID);

    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks.every((task) => task.tenantId === TENANT_A_ID)).toBe(true);

    const timestamps = tasks.map((task) => Date.parse(task.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("returns an empty array for a tenant with no tasks", async () => {
    const repo = createSupabaseTaskRepository(contextB);
    await expect(repo.listByTenant(TENANT_B_ID)).resolves.toEqual([]);
    const paged = await repo.listByTenantPaged(TENANT_B_ID);
    expect(paged).toEqual({ items: [], nextCursor: null });
  });

  describe("pagination", () => {
    it("pages through every task with no gap and no duplicate, in the same order as the unpaginated list", async () => {
      const repo = createSupabaseTaskRepository(contextA);

      const whole = await repo.listByTenant(TENANT_A_ID);
      expect(whole.length).toBeGreaterThanOrEqual(2);

      const collected: string[] = [];
      let cursor: string | undefined;

      do {
        const page = await repo.listByTenantPaged(TENANT_A_ID, { limit: 1, cursor });
        expect(page.items.length).toBeLessThanOrEqual(1);
        collected.push(...page.items.map((task) => task.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(collected).toEqual(whole.map((task) => task.id));
      expect(new Set(collected).size).toBe(collected.length);
    });

    it("reports nextCursor: null once the final page is reached", async () => {
      const repo = createSupabaseTaskRepository(contextA);
      const whole = await repo.listByTenant(TENANT_A_ID);

      const lastPage = await repo.listByTenantPaged(TENANT_A_ID, { limit: whole.length + 10 });
      expect(lastPage.nextCursor).toBeNull();
      expect(lastPage.items.length).toBe(whole.length);
    });
  });

  it("cross-tenant isolation: tenant B's owner sees none of tenant A's tasks", async () => {
    const repo = createSupabaseTaskRepository(contextB);
    const tasks = await repo.listByTenant(TENANT_B_ID);
    expect(tasks.every((task) => task.tenantId !== TENANT_A_ID)).toBe(true);
  });
});
