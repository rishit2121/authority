import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv, OWNER_A } from "./local-env";

/**
 * Issue #58, against a throwaway LOCAL Supabase only (destructive statements are attempted here and never
 * against a hosted project). The five alignment tables must refuse every write and TRUNCATE from anon and
 * authenticated, while tenant reads and the SECURITY DEFINER write path keep working, and new tables must
 * start without anon privileges and with SELECT-only for authenticated.
 */

const env = localSupabaseEnv();
const TABLES = [
  "alignment_reviews",
  "alignment_settings",
  "external_content_items",
  "task_alignment_state",
  "task_objectives",
] as const;
let db: pg.Client;
let ownerId: string;
let tenantId: string;
let applicationId: string;

beforeAll(async () => {
  db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
  const owner = (
    await db.query(
      `select u.id, m.tenant_id from auth.users u join public.tenant_memberships m on m.user_id = u.id
       where u.email = $1 and m.role = 'owner' limit 1`,
      [OWNER_A],
    )
  ).rows[0];
  ownerId = owner.id;
  tenantId = owner.tenant_id;
  applicationId = (
    await db.query(
      `insert into public.applications (tenant_id, name, slug) values ($1, 'acl test', $2) returning id`,
      [tenantId, `acl-test-${Date.now()}`],
    )
  ).rows[0].id;
});

afterAll(async () => {
  await db?.end();
});

/** Runs one statement as `role` (with the owner's JWT claims for authenticated) and always rolls back. */
async function attempt(role: "anon" | "authenticated", sql: string): Promise<string> {
  await db.query("begin");
  try {
    if (role === "authenticated") {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: ownerId, role: "authenticated" }),
      ]);
    }
    await db.query(`set local role ${role}`);
    await db.query(sql);
    return "allowed";
  } catch (error) {
    return (error as { code?: string }).code ?? "error";
  } finally {
    await db.query("rollback");
  }
}

describe("alignment tables: no mutation or table-level privileges for anon/authenticated", () => {
  for (const table of TABLES) {
    it(`${table}: INSERT, UPDATE, DELETE and TRUNCATE are refused at the privilege layer`, async () => {
      for (const role of ["authenticated", "anon"] as const) {
        expect(await attempt(role, `insert into public.${table} default values`), `${role} insert`).toBe(
          "42501",
        );
        expect(
          await attempt(role, `update public.${table} set tenant_id = tenant_id where true`),
          `${role} update`,
        ).toBe("42501");
        expect(await attempt(role, `delete from public.${table} where true`), `${role} delete`).toBe("42501");
        expect(await attempt(role, `truncate public.${table}`), `${role} truncate`).toBe("42501");
        expect(
          await attempt(role, `lock table public.${table} in access exclusive mode`),
          `${role} lock (MAINTAIN)`,
        ).toBe("42501");
      }
    });
  }

  it("tenant-scoped reads still work for a signed-in member", async () => {
    const owner = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
    await owner.auth.signInWithPassword({ email: OWNER_A, password: FIXTURE_PASSWORD });
    for (const table of TABLES) {
      const { error } = await owner.from(table).select("*").limit(1);
      expect(error, table).toBeNull();
    }
  });

  it("the SECURITY DEFINER write path still works (alignment settings via the dashboard RPC)", async () => {
    const owner = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
    await owner.auth.signInWithPassword({ email: OWNER_A, password: FIXTURE_PASSWORD });
    const set = await owner.rpc("set_alignment_settings", {
      p_application_id: applicationId,
      p_mode: "shadow",
      p_policy: "production",
    });
    expect(set.error).toBeNull();
    expect(set.data).toBe("ok");
    const read = await owner
      .from("alignment_settings")
      .select("mode")
      .eq("application_id", applicationId)
      .single();
    expect(read.data?.mode).toBe("shadow");
  });

  it("a newly created public table starts with no anon privilege and SELECT-only for authenticated", async () => {
    await db.query("begin");
    try {
      await db.query("set local role postgres");
      await db.query("create table public.acl_default_probe (id int)");
      const privs = async (role: string) =>
        (
          await db.query(
            `select array_agg(p) filter (where has_table_privilege($1, 'public.acl_default_probe', p)) as got
             from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p`,
            [role],
          )
        ).rows[0].got ?? [];
      expect(await privs("anon")).toEqual([]);
      expect(await privs("authenticated")).toEqual(["SELECT"]);
    } finally {
      await db.query("rollback");
    }
  });
});
