/**
 * LOCAL ONLY. Provisions what a developer gets from the dashboard (an app, an agent, both keys, one Slack
 * workspace-bot connection shared with exactly one customer), so a starter made by `npm run authority -- init`
 * can be run end to end against `npm run dev` with SLACK_FIXTURE_MODE=1. Uses fixture tenant B, so it never touches
 * tenant A's connections. Writes the starter's .env directly; prints no secret.
 *
 *   node --conditions=react-server --import tsx scripts/local-provision-starter.mts <starter-dir>
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import { setConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";
import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv, OWNER_B } from "../src/tests/local/local-env.ts";

const TENANT_B = "22222222-2222-4222-8222-222222222222";
const BASE_URL = process.env.AUTHORITY_URL ?? "http://localhost:3000";
const target = process.argv[2];
if (!target) throw new Error("usage: local-provision-starter.mts <starter-dir>");
if (!["localhost", "127.0.0.1"].includes(new URL(BASE_URL).hostname)) throw new Error("local only");

const env = localSupabaseEnv();
process.env.GATEWAY_DATABASE_URL ??=
  "postgresql://authority_gateway:ci-only-gateway-password@127.0.0.1:54322/postgres";
process.env.GATEWAY_DATABASE_SSL ??= "disable";

const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();
const adminId = (await db.query<{ id: string }>(`select id from auth.users where email = $1`, [OWNER_B]))
  .rows[0].id;
const owner = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
const signIn = await owner.auth.signInWithPassword({ email: OWNER_B, password: FIXTURE_PASSWORD });
if (signIn.error) throw new Error(`sign-in: ${signIn.error.message}`);

const stamp = `starter-check-${Date.now().toString(36)}`;
const { data: app } = await owner.rpc("create_application", {
  p_tenant_id: TENANT_B,
  p_name: stamp,
  p_slug: stamp,
  p_environment: "production",
});
const appId = app![0].app_application_id as string;
await owner.rpc("set_application_require_task_sessions", { p_application_id: appId, p_required: true });
const { data: bk } = await owner.rpc("create_backend_credential", { p_application_id: appId, p_name: stamp });
const { data: principal } = await owner.rpc("ensure_human_principal_for_current_user", {
  p_tenant_id: TENANT_B,
});
const { data: agent } = await owner
  .from("agents")
  .insert({
    tenant_id: TENANT_B,
    name: stamp,
    model: "none",
    model_provider: "none",
    framework: "starter-check",
    owner_principal_id: principal as string,
  })
  .select("id")
  .single();
const { data: ak } = await owner.rpc("create_agent_credential", { p_agent_id: agent!.id });

for (const row of (
  await db.query<{ id: string }>(
    `select id from public.connector_connections where tenant_id = $1 and connector_id = 'slack' and status <> 'disconnected' and name like 'starter-check-%'`,
    [TENANT_B],
  )
).rows) {
  await disconnectConnectorConnection({ tenantId: TENANT_B, userId: adminId, connectionId: row.id });
}
const created = await createConnectorConnection({
  tenantId: TENANT_B,
  userId: adminId,
  connectorId: "slack",
  name: stamp,
  environment: "development",
});
if (created.status !== "ok" || !created.connectionId) throw new Error(`connection: ${created.status}`);
const secret = await setConnectorSecret({
  tenantId: TENANT_B,
  userId: adminId,
  connectionId: created.connectionId,
  secretType: "bearer_token",
  plaintextSecret: "xoxb-local-fixture-token",
});
if (secret !== "ok") throw new Error(`token: ${secret}`);

const userId = `${stamp}-user`;
const customer = await fetch(`${BASE_URL}/api/v1/customers`, {
  method: "POST",
  headers: { authorization: `Bearer ${bk![0].plaintext_secret}`, "content-type": "application/json" },
  body: JSON.stringify({ externalId: userId }),
}).then((r) => r.json() as Promise<{ customerId: string }>);
const { data: grant } = await owner.rpc("grant_connection_delegation", {
  p_connection_id: created.connectionId,
  p_customer_id: customer.customerId,
});
if (grant !== "ok") throw new Error(`grant: ${grant}`);

writeFileSync(
  path.join(target, ".env"),
  [
    `AUTHORITY_URL=${BASE_URL}`,
    `AUTHORITY_BACKEND_API_KEY=${bk![0].plaintext_secret}`,
    `AUTHORITY_AGENT_ID=${agent!.id}`,
    `AUTHORITY_AGENT_RUNTIME_KEY=${ak![0].plaintext_secret}`,
    `SLACK_CONNECTION_ID=${created.connectionId}`,
    `AUTHORITY_USER_ID=${userId}`,
    `EVENT_ID=${stamp}-event`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
await db.end();
console.log(`Provisioned ${stamp} in tenant B and wrote ${path.join(target, ".env")} (values not shown).`);
