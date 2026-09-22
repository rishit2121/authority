import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSupabaseTaskRepository } from "@/lib/persistence/supabase/task-repository";
import {
  createSupabaseCapabilityRepository,
  createSupabaseDecisionRepository,
} from "@/lib/persistence/supabase/decision-repository";
import type { RepositoryContext } from "@/lib/persistence/context";

import { OWNER_A_EMAIL, TENANT_A_ID, managementQuery, signInAs } from "../support";

describe("Supabase decision and capability repositories", () => {
  let context: RepositoryContext;
  let task991Id: string;

  beforeAll(async () => {
    context = (await signInAs(OWNER_A_EMAIL, TENANT_A_ID)).context;

    const tasks = await createSupabaseTaskRepository(context).listByTenant(TENANT_A_ID);
    const task = tasks.find((t) => t.intent.includes("issue #991"));
    expect(task).toBeDefined();
    task991Id = task!.id;
  });

  afterAll(async () => {
    await context.supabase.auth.signOut();
  });

  it("lists every decision for the task, in requested order", async () => {
    const repo = createSupabaseDecisionRepository(context);
    const decisions = await repo.listByTaskId(task991Id);

    expect(decisions.length).toBeGreaterThanOrEqual(6);
    expect(decisions.every((decision) => decision.taskId === task991Id)).toBe(true);

    const timestamps = decisions.map((decision) => Date.parse(decision.decidedAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("embeds semantic evidence on the decision that has it, and only that one", async () => {
    const repo = createSupabaseDecisionRepository(context);
    const decisions = await repo.listByTaskId(task991Id);

    const withEvidence = decisions.filter((decision) => decision.semanticEvidence !== undefined);
    expect(withEvidence.length).toBeGreaterThanOrEqual(1);
    expect(withEvidence[0].semanticEvidence?.provider).toBe("mock");

    const denied = decisions.find((decision) => decision.status === "deny");
    expect(denied).toBeDefined();
    expect(denied?.semanticEvidence).toBeUndefined();
  });

  it("includes the hard-denied request among the decisions, matching the deterministic evaluator's design", async () => {
    const repo = createSupabaseDecisionRepository(context);
    const decisions = await repo.listByTaskId(task991Id);
    const denied = decisions.find((decision) => decision.status === "deny");

    expect(denied?.reasons.some((reason) => reason.code === "FORBIDDEN_RESOURCE")).toBe(true);
  });

  describe("pagination", () => {
    it("pages through decisions with no gap or duplicate", async () => {
      const repo = createSupabaseDecisionRepository(context);
      const whole = await repo.listByTaskId(task991Id);

      const collected: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await repo.listByTaskIdPaged(task991Id, { limit: 2, cursor });
        collected.push(...page.items.map((decision) => decision.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(new Set(collected)).toEqual(new Set(whole.map((decision) => decision.id)));
      expect(collected.length).toBe(whole.length);
    });
  });

  describe("active capabilities", () => {
    // The demo dataset's capabilities are all already consumed or expired —
    // realistic for a finished demo, but it means there is nothing "active"
    // to observe without creating some. `capabilities` has no client INSERT
    // grant at all (by design — see 20260923000008_product_rls.sql), so this
    // temporarily flips one existing row via the Management API, the same
    // privileged path the demo installer itself uses, and reverts it
    // afterwards regardless of pass or fail.
    let flippedCapabilityId: string | null = null;

    afterAll(async () => {
      if (!flippedCapabilityId) return;
      await managementQuery(
        `update public.capabilities set status = 'consumed', expires_at = expires_at ` +
          `where id = '${flippedCapabilityId}'`,
      );
    });

    it("lists only active capabilities for the tenant, ordered by soonest expiry", async () => {
      const repo = createSupabaseCapabilityRepository(context);
      const before = await repo.listActiveByTenant(TENANT_A_ID);
      const anyCapability = await repo.listByTaskId(task991Id);
      expect(anyCapability.length).toBeGreaterThan(0);

      flippedCapabilityId = anyCapability[0].id;
      const farExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await managementQuery(
        `update public.capabilities set status = 'active', expires_at = '${farExpiry}' ` +
          `where id = '${flippedCapabilityId}'`,
      );

      const after = await repo.listActiveByTenant(TENANT_A_ID);
      expect(after.length).toBe(before.length + 1);
      expect(after.every((capability) => capability.status === "active")).toBe(true);
      expect(after.some((capability) => capability.id === flippedCapabilityId)).toBe(true);

      const expiries = after.map((capability) => Date.parse(capability.expiresAt));
      expect(expiries).toEqual([...expiries].sort((a, b) => a - b));
    });
  });
});
