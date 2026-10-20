import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv, OWNER_A, VIEWER_A } from "./local-env";

/**
 * Per-application opt-in for automatic execution of published Custom API writes, against a throwaway
 * LOCAL Supabase. Settings changes go through the real API path (signed-in supabase-js → PostgREST → RPC).
 * Fixture rows are created directly in this local database only.
 */

const env = localSupabaseEnv();
let db: pg.Client;
const ids: Record<string, string> = {};

async function signedIn(email: string): Promise<SupabaseClient<Database>> {
  const c = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: FIXTURE_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

async function asGateway(sql: string, params: unknown[]) {
  await db.query("begin");
  try {
    await db.query("set local role authority_gateway");
    const r = await db.query(sql, params);
    await db.query("commit");
    return r.rows;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
const autoExecuteFor = async (taskId: string) =>
  (await asGateway(`select gateway.auto_execute_tools_for_task($1::uuid) as t`, [taskId]))[0].t as string[];

beforeAll(async () => {
  db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
  const tenant = (
    await db.query(
      `select tenant_id from public.tenant_memberships m join auth.users u on u.id = m.user_id where u.email = $1 and m.role = 'owner' limit 1`,
      [OWNER_A],
    )
  ).rows[0].tenant_id;
  ids.tenant = tenant;
  const app = async (slug: string) =>
    (
      await db.query(
        `insert into public.applications (tenant_id, name, slug) values ($1, $2, $2) returning id`,
        [tenant, slug],
      )
    ).rows[0].id;
  ids.appOptIn = await app(`auto-exec-in-${Date.now()}`);
  ids.appDefault = await app(`auto-exec-default-${Date.now()}`);
  const customer = async (appId: string, ext: string) =>
    (
      await db.query(
        `insert into public.customers (tenant_id, application_id, external_id) values ($1, $2, $3) returning id`,
        [tenant, appId, ext],
      )
    ).rows[0].id;
  const connId = (await db.query(`select gen_random_uuid() as id`)).rows[0].id as string;
  const connectorId = `custom_${connId.replace(/-/g, "")}`;
  await db.query(
    `insert into public.connector_connections (id, tenant_id, connector_id, name) values ($1, $2, $3, 'auto-exec recorder')`,
    [connId, tenant, connectorId],
  );
  const opInsert = `insert into public.custom_operation_definitions
      (tenant_id, connection_id, operation_slug, tool_name, name, method, path_template, effect, input_schema, request_mapping,
       status, input_schema_hash, request_mapping_hash, validated_at, published_at)
    values ($1, $2, $3, $4, $3, $5, '/v1/x', $6, '{"schemaVersion":1,"fields":[]}', '{"schemaVersion":1}',
       'published', repeat('a', 64), repeat('b', 64), now(), now()) returning id`;
  ids.writeOp = (
    await db.query(opInsert, [
      tenant,
      connId,
      "post_message",
      `${connectorId}.post_message`,
      "POST",
      "write_create",
    ])
  ).rows[0].id;
  ids.otherWriteOp = (
    await db.query(opInsert, [
      tenant,
      connId,
      "send_email",
      `${connectorId}.send_email`,
      "POST",
      "write_create",
    ])
  ).rows[0].id;
  ids.readOp = (
    await db.query(opInsert, [tenant, connId, "read_email", `${connectorId}.read_email`, "GET", "read"])
  ).rows[0].id;
  ids.tool = `${connectorId}.post_message`;
  // The local seed has no agents: create a principal and an agent for the fixture tasks.
  const principal = (
    await db.query(
      `insert into public.principals (tenant_id, kind, display_name) values ($1, 'human', 'auto-exec tester') returning id`,
      [tenant],
    )
  ).rows[0].id;
  const agent = (
    await db.query(
      `insert into public.agents (tenant_id, name, model_provider, model, framework, owner_principal_id)
      values ($1, 'auto-exec agent', 'test', 'test', 'test', $2) returning id`,
      [tenant, principal],
    )
  ).rows[0];
  const task = async (customerId: string) =>
    (
      await db.query(
        `insert into public.tasks (tenant_id, agent_id, principal_id, intent, customer_id) values ($1, $2, $3, 'auto-exec test', $4) returning id`,
        [tenant, agent.id, principal, customerId],
      )
    ).rows[0].id;
  ids.taskOptIn = await task(await customer(ids.appOptIn, "alex-auto"));
  ids.taskDefault = await task(await customer(ids.appDefault, "bob-auto"));
});

afterAll(async () => {
  await db?.end();
});

describe("Custom API automatic execution opt-in", () => {
  it("is off by default: no application has opted-in tools", async () => {
    expect(await autoExecuteFor(ids.taskOptIn)).toEqual([]);
    expect(await autoExecuteFor(ids.taskDefault)).toEqual([]);
  });

  it("only security admins and above can change it", async () => {
    const viewer = await signedIn(VIEWER_A);
    const r = await viewer.rpc("set_custom_operation_auto_execute", {
      p_application_id: ids.appOptIn,
      p_operation_definition_id: ids.writeOp,
      p_enabled: true,
      p_note: "x",
    });
    expect(r.data).toBe("forbidden");
    expect(await autoExecuteFor(ids.taskOptIn)).toEqual([]);
  });

  it("cannot be written directly, only through the audited RPC", async () => {
    const owner = await signedIn(OWNER_A);
    const direct = await owner.from("application_custom_operation_auto_execute" as never).insert({
      application_id: ids.appOptIn,
      operation_definition_id: ids.writeOp,
      tenant_id: ids.tenant,
      tool_name: ids.tool,
      enabled_by: ids.tenant,
    } as never);
    expect(direct.error).not.toBeNull();
  });

  it("opts in exactly one operation for exactly one application, with an audit record", async () => {
    const owner = await signedIn(OWNER_A);
    const r = await owner.rpc("set_custom_operation_auto_execute", {
      p_application_id: ids.appOptIn,
      p_operation_definition_id: ids.writeOp,
      p_enabled: true,
      p_note: "pilot recorder",
    });
    expect(r.data).toBe("ok");
    expect(await autoExecuteFor(ids.taskOptIn)).toEqual([ids.tool]);
    expect(await autoExecuteFor(ids.taskDefault)).toEqual([]); // another application of the same tenant is unaffected
    const audit = await owner
      .from("custom_operation_auto_execute_audit")
      .select("action, tool_name, note")
      .eq("application_id", ids.appOptIn);
    expect(audit.data).toEqual([{ action: "enabled", tool_name: ids.tool, note: "pilot recorder" }]);
  });

  it("refuses reads and unknown operations", async () => {
    const owner = await signedIn(OWNER_A);
    expect(
      (
        await owner.rpc("set_custom_operation_auto_execute", {
          p_application_id: ids.appOptIn,
          p_operation_definition_id: ids.readOp,
          p_enabled: true,
          p_note: "",
        })
      ).data,
    ).toBe("invalid_request");
    expect(
      (
        await owner.rpc("set_custom_operation_auto_execute", {
          p_application_id: ids.appOptIn,
          p_operation_definition_id: "00000000-0000-4000-8000-000000000000",
          p_enabled: true,
          p_note: "",
        })
      ).data,
    ).toBe("not_found");
  });

  it("can be turned off with an audit record", async () => {
    const owner = await signedIn(OWNER_A);
    const off = await owner.rpc("set_custom_operation_auto_execute", {
      p_application_id: ids.appOptIn,
      p_operation_definition_id: ids.writeOp,
      p_enabled: false,
      p_note: "done",
    });
    expect(off.data).toBe("ok");
    expect(await autoExecuteFor(ids.taskOptIn)).toEqual([]);
    const audit = await owner
      .from("custom_operation_auto_execute_audit")
      .select("action")
      .eq("application_id", ids.appOptIn)
      .order("created_at");
    expect(audit.data?.map((a) => a.action)).toEqual(["enabled", "disabled"]);
  });

  it("ends when the operation is retired (retirement is permanent)", async () => {
    const owner = await signedIn(OWNER_A);
    const on = await owner.rpc("set_custom_operation_auto_execute", {
      p_application_id: ids.appOptIn,
      p_operation_definition_id: ids.otherWriteOp,
      p_enabled: true,
      p_note: "retire test",
    });
    expect(on.data).toBe("ok");
    expect(await autoExecuteFor(ids.taskOptIn)).toHaveLength(1);
    await db.query(
      `update public.custom_operation_definitions set status = 'retired', retired_at = now() where id = $1`,
      [ids.otherWriteOp],
    );
    expect(await autoExecuteFor(ids.taskOptIn)).toEqual([]);
  });

  it("keeps the audit trail append-only", async () => {
    await expect(
      db.query(
        `update public.custom_operation_auto_execute_audit set note = 'edited' where application_id = $1`,
        [ids.appOptIn],
      ),
    ).rejects.toThrow();
  });
});
