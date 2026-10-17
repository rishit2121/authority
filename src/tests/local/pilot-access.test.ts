import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv, OWNER_A, OWNER_B, VIEWER_A } from "./local-env";

/**
 * Invite-only pilot against a throwaway LOCAL Supabase.
 *
 * Owner and gate actions go through the real API path the dashboard uses:
 * a signed-in supabase-js client -> PostgREST (authenticator, with
 * pg-safeupdate loaded, exactly as in production) -> the RPC. The direct
 * database connection is used only for setup and to read back state.
 */

const env = localSupabaseEnv();
let db: pg.Client;
const clients = new Map<string, SupabaseClient<Database>>();

async function signedIn(email: string): Promise<SupabaseClient<Database>> {
  const existing = clients.get(email);
  if (existing) return existing;
  const client = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: FIXTURE_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  clients.set(email, client);
  return client;
}

const anon = () => createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });

async function gate(): Promise<boolean> {
  return (await db.query(`select gate_enabled from public.pilot_settings`)).rows[0].gate_enabled;
}

async function asGateway<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  await db.query("begin");
  try {
    await db.query("set local role authority_gateway");
    const rows = (await db.query<T>(sql, params)).rows;
    await db.query("commit");
    return rows;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

const IP_A = "a".repeat(64);
const IP_B = "b".repeat(64);
const submit = (email: string, ip = IP_A, name = "Ada") =>
  asGateway<{ spr_status: string; spr_request_id: string; spr_is_new: boolean; spr_owner_email: string }>(
    `select * from gateway.submit_pilot_request($1, $2, null, 'an agent', 'scoped refunds', null, $3)`,
    [name, email, ip],
  ).then((r) => r[0]);

beforeAll(async () => {
  db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
  // Local only: owner A owns the pilot here, gate on.
  await db.query(`update public.pilot_settings set owner_email = $1, gate_enabled = true where id`, [
    OWNER_A,
  ]);
});

beforeEach(async () => {
  await db.query(`update public.pilot_settings set gate_enabled = true where id`);
  await db.query(`delete from public.pilot_access where true`);
  await db.query(`delete from public.pilot_request_attempts where true`);
});

afterAll(async () => {
  await db?.query(`update public.pilot_settings set gate_enabled = true where id`);
  await db?.end();
});

describe("precondition", () => {
  it("API requests run with pg-safeupdate, as in production", async () => {
    const { rows } = await db.query(`select rolconfig from pg_roles where rolname = 'authenticator'`);
    expect(String(rows[0].rolconfig)).toContain("safeupdate");
  });
});

describe("gate toggle through the authenticated API", () => {
  it("the owner turns the gate off and back on", async () => {
    const owner = await signedIn(OWNER_A);
    const off = await owner.rpc("pilot_admin_set_gate", { p_enabled: false });
    expect(off.error).toBeNull();
    expect(off.data).toBe("ok");
    expect(await gate()).toBe(false);
    expect((await owner.rpc("pilot_viewer")).data?.[0]).toMatchObject({
      pv_gate_enabled: false,
      pv_is_owner: true,
    });

    const on = await owner.rpc("pilot_admin_set_gate", { p_enabled: true });
    expect(on.error).toBeNull();
    expect(await gate()).toBe(true);
  });

  it("nobody else can switch it", async () => {
    for (const email of [OWNER_B, VIEWER_A]) {
      const r = await (await signedIn(email)).rpc("pilot_admin_set_gate", { p_enabled: false });
      expect(r.error?.code, email).toBe("42501");
    }
    expect((await anon().rpc("pilot_admin_set_gate", { p_enabled: false })).error).not.toBeNull();
    expect(await gate()).toBe(true);
  });
});

describe("allowlist through the authenticated API", () => {
  it("ordinary users and anon cannot read or manage it", async () => {
    for (const client of [anon(), await signedIn(VIEWER_A)]) {
      expect((await client.from("pilot_access" as never).select("*")).error).not.toBeNull();
      expect((await client.from("pilot_settings" as never).select("*")).error).not.toBeNull();
      expect((await client.rpc("pilot_admin_list")).error).not.toBeNull();
      expect((await client.rpc("pilot_admin_accounts")).error).not.toBeNull();
      expect(
        (await client.rpc("pilot_admin_add", { p_email: VIEWER_A, p_name: null, p_notes: null })).error,
      ).not.toBeNull();
    }
  });

  it("an unapproved account is refused; owner approval and revocation take effect", async () => {
    const viewer = await signedIn(VIEWER_A);
    expect((await viewer.rpc("pilot_viewer")).data?.[0]?.pv_access).toBe("not_approved");
    expect((await viewer.rpc("ensure_onboarded")).error?.code).toBe("42501");

    const owner = await signedIn(OWNER_A);
    const add = await owner.rpc("pilot_admin_add", {
      p_email: ` ${VIEWER_A.toUpperCase()} `,
      p_name: "Vee",
      p_notes: null,
    });
    expect(add.data).toBe("ok");
    expect((await viewer.rpc("pilot_viewer")).data?.[0]?.pv_access).toBe("eligible");
    expect((await viewer.rpc("ensure_onboarded")).error).toBeNull();

    const list = await owner.rpc("pilot_admin_list");
    const row = list.data?.find((r) => r.email_normalized === VIEWER_A);
    expect(row?.status).toBe("approved");
    const accounts = await owner.rpc("pilot_admin_accounts");
    expect(accounts.data?.find((a) => a.pa_email === VIEWER_A)?.pa_status).toBe("approved");

    const revoke = await owner.rpc("pilot_admin_update", {
      p_id: row!.id,
      p_status: "declined",
      p_notes: "x",
    });
    expect(revoke.data).toBe("ok");
    expect((await viewer.rpc("pilot_viewer")).data?.[0]?.pv_access).toBe("not_approved");
  });

  it("an account created by calling Supabase directly gets no workspace", async () => {
    const client = anon();
    const email = `direct-${Date.now()}@pilot-local.authority.test`;
    const { data, error } = await client.auth.signUp({ email, password: "a-long-password-123" });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull(); // local config skips email confirmation
    expect((await client.rpc("pilot_viewer")).data?.[0]?.pv_access).toBe("not_approved");
    expect((await client.rpc("ensure_onboarded")).error?.code).toBe("42501");
    const { rows } = await db.query(
      `select count(*)::int as n from public.tenant_memberships m join auth.users u on u.id = m.user_id where u.email = $1`,
      [email],
    );
    expect(rows[0].n).toBe(0);
  });

  it("the gate off is a no-op for everyone", async () => {
    await (await signedIn(OWNER_A)).rpc("pilot_admin_set_gate", { p_enabled: false });
    expect((await (await signedIn(VIEWER_A)).rpc("pilot_viewer")).data?.[0]?.pv_access).toBe("eligible");
  });
});

describe("public request submission (gateway role)", () => {
  it("saves, dedups on trimmed lowercase email, never resets status or notes", async () => {
    const first = await submit("Dev@Pilot-Local.authority.test");
    expect(first).toMatchObject({ spr_status: "ok", spr_is_new: true, spr_owner_email: OWNER_A });
    await (
      await signedIn(OWNER_A)
    ).rpc("pilot_admin_update", {
      p_id: first.spr_request_id,
      p_status: "approved",
      p_notes: "met at meetup",
    });
    const again = await submit("  dev@pilot-local.authority.test ", IP_B, "Ada L");
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
    expect(row).toEqual({ status: "approved", admin_notes: "met at meetup", submit_count: 2, name: "Ada L" });
  });

  it("rate-limits per email (3/hour) and per IP (5/hour)", async () => {
    for (let i = 0; i < 3; i++)
      expect((await submit("rl@pilot-local.authority.test", IP_A)).spr_status).toBe("ok");
    expect((await submit("rl@pilot-local.authority.test", IP_B)).spr_status).toBe("rate_limited");
    for (let i = 0; i < 2; i++) await submit(`ip${i}@pilot-local.authority.test`, IP_A);
    expect((await submit("ip9@pilot-local.authority.test", IP_A)).spr_status).toBe("rate_limited");
  });

  it("rejects invalid input in the database", async () => {
    expect((await submit("not-an-email")).spr_status).toBe("invalid_request");
    expect((await submit("x@pilot-local.authority.test", "nothex")).spr_status).toBe("invalid_request");
    const long = await asGateway<{ spr_status: string }>(
      `select * from gateway.submit_pilot_request('A', 'l@pilot-local.authority.test', null, repeat('x', 2001), 'u', null, $1)`,
      [IP_A],
    );
    expect(long[0].spr_status).toBe("invalid_request");
  });

  it("records notification status, and sign-up pre-check follows approval", async () => {
    const r = await submit("n@pilot-local.authority.test");
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
    const allowed = async (email: string) =>
      (await asGateway<{ a: boolean }>(`select gateway.pilot_signup_allowed($1) as a`, [email]))[0].a;
    expect(await allowed("n@pilot-local.authority.test")).toBe(false);
    expect(await allowed(OWNER_A)).toBe(true);
  });
});

describe("structure", () => {
  it("no pilot function runs UPDATE/DELETE without WHERE (pg-safeupdate rejects them)", async () => {
    const { rows } = await db.query<{ fn: string; src: string }>(`
      select n.nspname || '.' || p.proname as fn, p.prosrc as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('gateway', 'authz', 'public') and p.prosrc ilike '%pilot%'`);
    const offenders = rows.filter((r) =>
      r.src
        .split(";")
        .some((stmt) => /\b(update|delete\s+from)\s+public\.pilot_/i.test(stmt) && !/\bwhere\b/i.test(stmt)),
    );
    expect(offenders.map((r) => r.fn)).toEqual([]);
  });

  it("external-customer paths never reference the pilot", async () => {
    const { rows } = await db.query<{ fn: string }>(`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('gateway', 'authz', 'public') and p.prosrc ilike '%pilot%'
      order by 1`);
    expect(rows.map((r) => r.fn)).toEqual(
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
