import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSupabaseEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

import { OWNER_A_EMAIL, OWNER_B_EMAIL, signInAs, TENANT_A_ID, VIEWER_A_EMAIL } from "./support";

/**
 * Invite-only pilot, against the real database.
 *
 * This is the shared linked project, so the global switch (gate on, owner) is
 * only ever flipped inside a transaction that is rolled back: nothing here
 * changes who can use the deployment. Inside it we act as a specific verified
 * user (role authenticated + request.jwt.claims, exactly what PostgREST sets)
 * or as the gateway role the server actions use.
 */

let db: pg.Client;
const ids: Record<string, string> = {};
const IP_A = "a".repeat(64);
const IP_B = "b".repeat(64);

beforeAll(async () => {
  db = new pg.Client({
    host: `db.${process.env.SUPABASE_PROJECT_REF}.supabase.co`,
    port: 5432,
    user: "postgres",
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const { rows } = await db.query<{ id: string; email: string }>(
    `select id, email from auth.users where email = any($1)`,
    [[OWNER_A_EMAIL, OWNER_B_EMAIL, VIEWER_A_EMAIL]],
  );
  for (const r of rows) ids[r.email] = r.id;
});

afterAll(async () => {
  await db?.end();
});

/** Runs `fn` in a transaction where the gate is on and owner.a is the owner; always rolled back. */
async function withGate<T>(fn: () => Promise<T>, gate = true): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`update public.pilot_settings set gate_enabled = $1, owner_email = $2`, [
      gate,
      OWNER_A_EMAIL,
    ]);
    // Fresh state for the emails these tests use, inside the rolled-back transaction only.
    await db.query(
      `delete from public.pilot_access where email_normalized like '%@pilot-it.authority.test'
                    or email_normalized = any($1)`,
      [[VIEWER_A_EMAIL, OWNER_B_EMAIL]],
    );
    await db.query(
      `delete from public.pilot_request_attempts where ip_hash in ($1, $2)
                    or email_normalized like '%@pilot-it.authority.test'`,
      [IP_A, IP_B],
    );
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

async function as<T extends pg.QueryResultRow>(email: string, sql: string, params: unknown[] = []) {
  await db.query("reset role");
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: ids[email], role: "authenticated" }),
  ]);
  await db.query("set local role authenticated");
  await db.query("savepoint s");
  try {
    const r = await db.query<T>(sql, params);
    await db.query("release savepoint s");
    return r.rows;
  } catch (error) {
    await db.query("rollback to savepoint s");
    throw error;
  } finally {
    await db.query("reset role");
  }
}

async function asGateway<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  await db.query("set local role authority_gateway");
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.query("reset role");
  }
}

const submit = (email: string, ip = IP_A, name = "Ada") =>
  asGateway<{ spr_status: string; spr_request_id: string; spr_is_new: boolean; spr_owner_email: string }>(
    `select * from gateway.submit_pilot_request($1, $2, null, 'an agent', 'scoped refunds', null, $3)`,
    [name, email, ip],
  ).then((r) => r[0]);

describe("public access", () => {
  it("anon cannot read the tables or call management/viewer functions", async () => {
    const { url, publishableKey } = getSupabaseEnv();
    const anon = createClient<Database>(url, publishableKey);
    for (const table of ["pilot_access", "pilot_settings", "pilot_request_attempts"]) {
      const { error } = await anon.from(table as never).select("*");
      expect(error, table).not.toBeNull();
    }
    for (const fn of ["pilot_admin_list", "pilot_admin_accounts", "pilot_viewer"] as const) {
      const { error } = await anon.rpc(fn);
      expect(error, fn).not.toBeNull();
    }
    const { error } = await anon.rpc("pilot_admin_set_gate", { p_enabled: false });
    expect(error).not.toBeNull();
  });

  it("an ordinary signed-in user cannot read requests or manage the allowlist", async () => {
    const { supabase } = await signInAs(VIEWER_A_EMAIL, TENANT_A_ID);
    const read = await supabase.from("pilot_access" as never).select("*");
    expect(read.error).not.toBeNull();
    expect((await supabase.rpc("pilot_admin_list")).error?.code).toBe("42501");
    expect((await supabase.rpc("pilot_admin_accounts")).error?.code).toBe("42501");
    expect(
      (await supabase.rpc("pilot_admin_add", { p_email: VIEWER_A_EMAIL, p_name: null, p_notes: null })).error
        ?.code,
    ).toBe("42501");
    expect((await supabase.rpc("pilot_admin_set_gate", { p_enabled: false })).error?.code).toBe("42501");
    const viewer = await supabase.rpc("pilot_viewer");
    expect(viewer.data?.[0]?.pv_is_owner).toBe(false);
  });
});

describe("request submission (gateway role)", () => {
  it("saves a new request, dedups on trimmed lowercase email, and never resets status", () =>
    withGate(async () => {
      const first = await submit("Dev@Pilot-IT.authority.test");
      expect(first).toMatchObject({ spr_status: "ok", spr_is_new: true, spr_owner_email: OWNER_A_EMAIL });

      await as(OWNER_A_EMAIL, `select public.pilot_admin_update($1, 'approved', 'met at meetup')`, [
        first.spr_request_id,
      ]);
      const again = await submit("  dev@pilot-it.authority.test ", IP_B, "Ada L");
      expect(again).toMatchObject({
        spr_status: "ok",
        spr_is_new: false,
        spr_request_id: first.spr_request_id,
      });
      const [row] = (
        await db.query(
          `select status, admin_notes, submit_count, name from public.pilot_access where id = $1`,
          [first.spr_request_id],
        )
      ).rows;
      expect(row).toMatchObject({
        status: "approved",
        admin_notes: "met at meetup",
        submit_count: 2,
        name: "Ada L",
      });
    }));

  it("rate-limits per email (3/hour) and per IP (5/hour)", () =>
    withGate(async () => {
      for (let i = 0; i < 3; i++)
        expect((await submit("rl@pilot-it.authority.test", IP_A)).spr_status).toBe("ok");
      expect((await submit("rl@pilot-it.authority.test", IP_B)).spr_status).toBe("rate_limited");
      for (let i = 0; i < 2; i++) await submit(`ip${i}@pilot-it.authority.test`, IP_A);
      expect((await submit("ip9@pilot-it.authority.test", IP_A)).spr_status).toBe("rate_limited");
    }));

  it("rejects invalid input in the database too", () =>
    withGate(async () => {
      expect((await submit("not-an-email")).spr_status).toBe("invalid_request");
      expect((await submit("x@pilot-it.authority.test", "nothex")).spr_status).toBe("invalid_request");
      const long = await asGateway<{ spr_status: string }>(
        `select * from gateway.submit_pilot_request('A', 'l@pilot-it.authority.test', null, repeat('x', 2001), 'u', null, $1)`,
        [IP_A],
      );
      expect(long[0].spr_status).toBe("invalid_request");
    }));

  it("records notification status without blocking anything", () =>
    withGate(async () => {
      const r = await submit("n@pilot-it.authority.test");
      await asGateway(`select gateway.record_pilot_notification($1, 'failed', 'resend http 500')`, [
        r.spr_request_id,
      ]);
      const [row] = (
        await db.query(
          `select notification_status, notification_detail from public.pilot_access where id = $1`,
          [r.spr_request_id],
        )
      ).rows;
      expect(row).toEqual({ notification_status: "failed", notification_detail: "resend http 500" });
    }));
});

describe("the gate", () => {
  it("refuses console standing and onboarding to an unapproved verified account", () =>
    withGate(async () => {
      const [v] = await as<{ pv_access: string; pv_is_owner: boolean }>(
        VIEWER_A_EMAIL,
        `select * from public.pilot_viewer()`,
      );
      expect(v).toMatchObject({ pv_access: "not_approved", pv_is_owner: false });
      await expect(as(VIEWER_A_EMAIL, `select * from public.ensure_onboarded()`)).rejects.toMatchObject({
        code: "42501",
      });
      const [allowed] = await asGateway<{ a: boolean }>(`select gateway.pilot_signup_allowed($1) as a`, [
        "stranger@pilot-it.authority.test",
      ]);
      expect(allowed.a).toBe(false);
    }));

  it("only the verified owner manages the allowlist; approval makes signup and onboarding work", () =>
    withGate(async () => {
      const [o] = await as<{ pv_access: string; pv_is_owner: boolean }>(
        OWNER_A_EMAIL,
        `select * from public.pilot_viewer()`,
      );
      expect(o).toMatchObject({ pv_access: "eligible", pv_is_owner: true });
      await expect(
        as(OWNER_B_EMAIL, `select public.pilot_admin_add($1, null, null)`, [VIEWER_A_EMAIL]),
      ).rejects.toMatchObject({ code: "42501" });

      const [added] = await as<{ r: string }>(
        OWNER_A_EMAIL,
        `select public.pilot_admin_add($1, 'Vee', null) as r`,
        [` ${VIEWER_A_EMAIL.toUpperCase()} `],
      );
      expect(added.r).toBe("ok");
      const [v] = await as<{ pv_access: string }>(VIEWER_A_EMAIL, `select * from public.pilot_viewer()`);
      expect(v.pv_access).toBe("eligible");
      const onboard = await as<{ tenant_id: string }>(
        VIEWER_A_EMAIL,
        `select * from public.ensure_onboarded()`,
      );
      expect(onboard.length).toBe(1);
      const [allowed] = await asGateway<{ a: boolean }>(`select gateway.pilot_signup_allowed($1) as a`, [
        VIEWER_A_EMAIL,
      ]);
      expect(allowed.a).toBe(true);

      const list = await as<{ email_normalized: string }>(
        OWNER_A_EMAIL,
        `select * from public.pilot_admin_list()`,
      );
      expect(list.some((r) => r.email_normalized === VIEWER_A_EMAIL)).toBe(true);
      const accounts = await as<{ pa_email: string; pa_status: string }>(
        OWNER_A_EMAIL,
        `select * from public.pilot_admin_accounts()`,
      );
      expect(accounts.find((a) => a.pa_email === VIEWER_A_EMAIL)?.pa_status).toBe("approved");

      // Revoke: the next check refuses again.
      const [{ id }] = (
        await db.query(`select id from public.pilot_access where email_normalized = $1`, [VIEWER_A_EMAIL])
      ).rows;
      await as(OWNER_A_EMAIL, `select public.pilot_admin_update($1, 'declined', null)`, [id]);
      const [after] = await as<{ pv_access: string }>(VIEWER_A_EMAIL, `select * from public.pilot_viewer()`);
      expect(after.pv_access).toBe("not_approved");
    }));

  it("is a no-op while the gate is off", () =>
    withGate(async () => {
      const [v] = await as<{ pv_access: string }>(VIEWER_A_EMAIL, `select * from public.pilot_viewer()`);
      expect(v.pv_access).toBe("eligible");
    }, false));

  it("does not touch external-customer paths: no credential-facing function or RLS helper references the pilot", async () => {
    const { rows } = await db.query<{ fn: string }>(`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('gateway', 'authz', 'public')
        and p.prosrc ilike '%pilot%'
      order by 1`);
    expect(rows.map((r) => r.fn).sort()).toEqual(
      [
        "authz.is_pilot_owner",
        "authz.pilot_access_for_current_user",
        "authz.require_pilot_owner",
        "gateway.pilot_signup_allowed",
        "gateway.record_pilot_notification",
        "gateway.submit_pilot_request",
        "public.ensure_onboarded",
        "public.pilot_admin_accounts",
        "public.pilot_admin_add",
        "public.pilot_admin_list",
        "public.pilot_admin_set_gate",
        "public.pilot_admin_update",
        "public.pilot_viewer",
      ].sort(),
    );
  });
});
