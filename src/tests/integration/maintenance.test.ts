import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeGatewayPool } from "@/lib/gateway/db";
import { EXPECTED_SCHEMA_VERSION } from "@/lib/gateway/schema-version";
import { runMaintenance } from "@/lib/maintenance";
import {
  dueInstallations,
  dueWebhookRetries,
  enqueueWebhookRetry,
  markWebhookRetry,
  retentionPurge,
  schemaVersion,
} from "@/lib/maintenance/db";

import {
  OWNER_A_EMAIL,
  OWNER_B_EMAIL,
  TENANT_A_ID,
  TENANT_B_ID,
  VIEWER_A_EMAIL,
  managementQuery,
  signInAs,
} from "./support";

const ENV_ID = "cccccccc-0000-4000-8000-00000000e001";
const OLD = "cccccccc-0000-4000-8000-00000000c001";
const RECENT = "cccccccc-0000-4000-8000-00000000c002";
const DELIVERY = "retry-test-delivery-0001";

const count = async (sql: string) => ((await managementQuery(sql)) as Array<{ n: number }>)[0].n;

async function cleanup() {
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.validation_campaigns where id in ('${OLD}', '${RECENT}');
    delete from public.validation_environments where id = '${ENV_ID}';
    delete from public.github_webhook_retries where delivery_id like 'retry-test-%';
    delete from public.tenant_retention_settings where tenant_id = '${TENANT_A_ID}';
  `);
}

describe("launch hardening: maintenance, retries, retention, readiness probe", () => {
  beforeAll(cleanup, 60_000);
  afterAll(async () => {
    await cleanup();
    await closeGatewayPool();
  }, 60_000);

  it("reports the schema version this build expects", async () => {
    expect(await schemaVersion()).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it("queues a failed webhook idempotently, backs off, and gives up on a poison delivery", async () => {
    const input = {
      deliveryId: DELIVERY,
      event: "installation",
      action: "suspend",
      installationId: "424242",
      removedRepositoryIds: [],
    };
    await enqueueWebhookRetry(input);
    await enqueueWebhookRetry(input); // same delivery id: no duplicate
    expect(
      await count(
        `select count(*)::int as n from public.github_webhook_retries where delivery_id = '${DELIVERY}';`,
      ),
    ).toBe(1);

    const due = (await dueWebhookRetries(50)).find((d) => d.deliveryId === DELIVERY);
    expect(due).toMatchObject({
      event: "installation",
      action: "suspend",
      installationId: "424242",
      attempts: 0,
    });

    await markWebhookRetry(DELIVERY, false, "timeout");
    // backed off: not due again immediately
    expect((await dueWebhookRetries(50)).find((d) => d.deliveryId === DELIVERY)).toBeUndefined();
    const [row] = (await managementQuery(
      `select attempts, status, last_error_category, next_attempt_at > now() as later from public.github_webhook_retries where delivery_id = '${DELIVERY}';`,
    )) as Array<{ attempts: number; status: string; last_error_category: string; later: boolean }>;
    expect(row).toMatchObject({
      attempts: 1,
      status: "pending",
      last_error_category: "timeout",
      later: true,
    });

    for (let i = 0; i < 7; i++) {
      await managementQuery(
        `update public.github_webhook_retries set next_attempt_at = now() where delivery_id = '${DELIVERY}';`,
      );
      await markWebhookRetry(DELIVERY, false, "timeout");
    }
    const [dead] = (await managementQuery(
      `select status, attempts from public.github_webhook_retries where delivery_id = '${DELIVERY}';`,
    )) as Array<{ status: string; attempts: number }>;
    expect(dead).toMatchObject({ status: "dead", attempts: 8 });
    expect(await markWebhookRetry(DELIVERY, true, "")).toBeUndefined(); // no longer pending: a no-op, never resurrected
  }, 120_000);

  it("retries a queued delivery through the maintenance run and marks it done", async () => {
    const id = "retry-test-delivery-0002";
    await enqueueWebhookRetry({
      deliveryId: id,
      event: "installation",
      action: "suspend",
      installationId: "999000999",
      removedRepositoryIds: [],
    });
    const report = await runMaintenance();
    expect(report.errors).toEqual([]);
    expect(report.webhookRetries?.succeeded).toBeGreaterThanOrEqual(1);
    const [row] = (await managementQuery(
      `select status from public.github_webhook_retries where delivery_id = '${id}';`,
    )) as Array<{ status: string }>;
    expect(row.status).toBe("done"); // an unknown installation is a recorded no-op, so the retry completes
    // and the delivery id is now recorded, so a replay is a duplicate
    expect(
      await count(
        `select count(*)::int as n from public.github_webhook_deliveries where delivery_id = '${id}';`,
      ),
    ).toBe(1);
    await managementQuery(
      `set local role postgres; select set_config('authority.allow_demo_purge','on',true); delete from public.github_webhook_deliveries where delivery_id = '${id}';`,
    );
  }, 120_000);

  it("a maintenance run is bounded, reports per step, and skips installation checks when GitHub is not live", async () => {
    const r = await runMaintenance();
    expect(r.errors).toEqual([]);
    expect(r.leasesReconciled).not.toBeNull();
    expect(r.validation).not.toBeNull();
    expect(r.retention).not.toBeNull();
    expect(r.installationsVerified === "skipped" || typeof r.installationsVerified === "object").toBe(true);
  }, 120_000);

  it("never offers mock or disconnected installations to the live re-verifier", async () => {
    const due = await dueInstallations(60, 100);
    const excluded = (await managementQuery(
      `select github_installation_id::text as id from public.github_installations where mode = 'mock' or status = 'disconnected';`,
    )) as Array<{ id: string }>;
    const dueIds = new Set(due.map((d) => d.githubInstallationId));
    for (const e of excluded) expect(dueIds.has(e.id)).toBe(false);
  });

  it("purges validation artifacts past retention, honors per-tenant settings, and never touches audit records", async () => {
    await managementQuery(`
      insert into public.validation_environments (id, tenant_id, name, spec, status, expires_at)
        values ('${ENV_ID}', '${TENANT_A_ID}', 'retention test', '{"schemaVersion":1}', 'ready', now() + interval '1 day');
      insert into public.validation_campaigns (id, tenant_id, environment_id, name, seed, config, status, finished_at)
        values ('${OLD}', '${TENANT_A_ID}', '${ENV_ID}', 'old', 1, '{}', 'completed', now() - interval '40 days'),
               ('${RECENT}', '${TENANT_A_ID}', '${ENV_ID}', 'recent', 1, '{}', 'completed', now() - interval '20 days');
    `);
    const decisionsBefore = await count(`select count(*)::int as n from public.authorization_decisions;`);
    const eventsBefore = await count(`select count(*)::int as n from public.agent_auth_events;`);

    await retentionPurge(500); // default 30 days
    expect(
      await count(`select count(*)::int as n from public.validation_campaigns where id = '${OLD}';`),
    ).toBe(0);
    expect(
      await count(`select count(*)::int as n from public.validation_campaigns where id = '${RECENT}';`),
    ).toBe(1);

    const owner = await signInAs(OWNER_A_EMAIL, TENANT_A_ID);
    expect(
      (await owner.supabase.rpc("set_retention_settings", { p_tenant_id: TENANT_A_ID, p_validation_days: 7 }))
        .data,
    ).toBe(7);
    await retentionPurge(500);
    expect(
      await count(`select count(*)::int as n from public.validation_campaigns where id = '${RECENT}';`),
    ).toBe(0);

    expect(await count(`select count(*)::int as n from public.authorization_decisions;`)).toBe(
      decisionsBefore,
    );
    expect(await count(`select count(*)::int as n from public.agent_auth_events;`)).toBe(eventsBefore);
  }, 120_000);

  it("retention settings: admin-only, validated, tenant-isolated", async () => {
    const viewer = await signInAs(VIEWER_A_EMAIL, TENANT_A_ID);
    expect(
      (
        await viewer.supabase.rpc("set_retention_settings", {
          p_tenant_id: TENANT_A_ID,
          p_validation_days: 10,
        })
      ).error?.code,
    ).toBe("42501");
    const owner = await signInAs(OWNER_A_EMAIL, TENANT_A_ID);
    expect(
      (await owner.supabase.rpc("set_retention_settings", { p_tenant_id: TENANT_A_ID, p_validation_days: 3 }))
        .error?.code,
    ).toBe("22023");
    expect(
      (
        await owner.supabase.rpc("set_retention_settings", {
          p_tenant_id: TENANT_A_ID,
          p_validation_days: 999,
        })
      ).error?.code,
    ).toBe("22023");
    const other = await signInAs(OWNER_B_EMAIL, TENANT_B_ID);
    expect(
      (
        await other.supabase.rpc("set_retention_settings", {
          p_tenant_id: TENANT_A_ID,
          p_validation_days: 10,
        })
      ).error?.code,
    ).toBe("P0002");
    // a client cannot write the table directly
    const direct = await owner.supabase
      .from("tenant_retention_settings")
      .update({ validation_days: 365 })
      .eq("tenant_id", TENANT_A_ID);
    expect(direct.error?.code).toBe("42501");
    // another tenant cannot read it
    expect(
      (
        (await other.supabase.from("tenant_retention_settings").select("*").eq("tenant_id", TENANT_A_ID))
          .data ?? []
      ).length,
    ).toBe(0);
  }, 60_000);

  it("webhook retry rows are not reachable by any client role", async () => {
    const owner = await signInAs(OWNER_A_EMAIL, TENANT_A_ID);
    const r = await owner.supabase.from("github_webhook_retries" as never).select("*");
    expect(r.error?.code === "42501" || (r.data ?? []).length === 0).toBe(true);
  }, 30_000);
});
