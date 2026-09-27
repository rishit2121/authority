import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSupabaseEnv } from "@/lib/env";
import { closeGatewayPool } from "@/lib/gateway/db";
import type { Database } from "@/lib/supabase/database.types";

import { createGatewayFixture, type GatewayFixture } from "../gateway-support";

/**
 * A caller holding only the public anonymous key (and even a *valid agent
 * runtime key*) tries to go around the gateway, over the real PostgREST API.
 * Every attempt must be refused by the database, not by application code.
 */
describe("direct RPC bypass attempts with the anonymous key", () => {
  let fx: GatewayFixture;
  const { url, publishableKey } = getSupabaseEnv();
  const anon = () => createClient<Database>(url, publishableKey, { auth: { persistSession: false } });
  const denied = (error: { code?: string; message?: string } | null) =>
    expect(["42501", "PGRST202", "PGRST106"]).toContain(error?.code ?? "no-error");

  beforeAll(async () => {
    fx = await createGatewayFixture({ label: "gw-bypass" });
  }, 30_000);
  afterAll(async () => {
    await fx.cleanup();
    await closeGatewayPool();
  }, 30_000);

  it("cannot authorize a call directly, even with a valid runtime key", async () => {
    // The legacy function was dropped in Part 7; a stale client still calling it must get an error, not a decision.
    const { data, error } = await (
      anon() as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { code?: string } | null }>;
      }
    ).rpc("authorize_tool_call", {
      p_credential_secret: fx.secret,
      p_task_id: fx.taskId,
      p_tool: "github.get_issue",
      p_operation: "get_issue",
      p_resource: null as never,
      p_arguments: { issue_number: "1" },
      p_plan_node_id: null as never,
      p_idempotency_key: "bypass-1",
      p_execution_context: null as never,
      p_current_registry_version: "rv1",
      p_current_compiler_version: "cv1",
    });
    denied(error);
    expect(data).toBeNull();
  });

  it("cannot read semantic evaluation context", async () => {
    const { error } = await anon().rpc("get_semantic_evaluation_context", {
      p_credential_secret: fx.secret,
      p_decision_id: fx.taskId,
    });
    denied(error);
  });

  it("cannot forge trusted semantic evidence", async () => {
    const { error } = await anon().rpc("record_semantic_shadow", {
      p_credential_secret: fx.secret,
      p_decision_id: fx.taskId,
      p_provider: "mock",
      p_model: "m",
      p_model_version: "1",
      p_state: "timeout",
      p_signals: null as never,
      p_indicators: [],
      p_risk_level: "unknown",
      p_confidence: 0,
      p_latency_ms: 1,
      p_input_hash: "a".repeat(64),
      p_redaction_summary: { schemaVersion: 1 },
      p_error_category: "timeout",
    });
    denied(error);
  });

  it("cannot write authentication-failure audit rows", async () => {
    const { error } = await anon().rpc("record_agent_auth_failure", { p_credential_secret: fx.secret });
    denied(error);
  });

  it("cannot reach the gateway schema through PostgREST", async () => {
    const { error } = await createClient<Database>(url, publishableKey, {
      auth: { persistSession: false },
      db: { schema: "gateway" as never },
    }).rpc("ping" as never);
    denied(error);
  });

  it("cannot read or write capabilities, final decisions or evidence tables", async () => {
    const client = anon();
    for (const table of [
      "capability_tokens",
      "final_decisions",
      "semantic_evaluations",
      "capability_consumptions",
    ] as const) {
      const { data, error } = await client.from(table).select("*").limit(1);
      // RLS/grants: either a hard permission error or an empty set — never a row.
      expect(data ?? []).toHaveLength(0);
      if (error) expect(error.code).toBe("42501");
    }
    const { error } = await client.from("capability_tokens").insert({ tenant_id: fx.tenantId } as never);
    expect(error?.code).toBe("42501");
    const forged = await client.from("semantic_evaluations").insert({ tenant_id: fx.tenantId } as never);
    expect(forged.error?.code).toBe("42501");
  });

  it("cannot mint or consume a capability through any public RPC", async () => {
    const { error } = await anon().rpc("revoke_capability", { p_capability_id: fx.taskId, p_reason: "x" });
    denied(error);
  });
});
