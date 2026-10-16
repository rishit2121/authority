import { createHash, randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createOrResolveCustomer } from "@/lib/gateway/rpc-customers";
import { listActivePoliciesForBackend } from "@/lib/gateway/rpc-tasks-lifecycle";

import { managementQuery, TENANT_B_ID } from "../support";

/**
 * Regression for a real bug found during a live (non-fixture) end-to-end
 * run against a real, policy-free tenant:
 * gateway.list_active_policies_for_backend's success branch was a bare
 * set-returning query with NO row at all when the tenant simply has zero
 * policies configured -- the normal state for any new or simple tenant,
 * not an error. The TS wrapper then read `rows[0]?.lap_status` as
 * "unknown", which developerApiFailureContract doesn't recognize, so
 * `POST /api/v1/tasks/{taskId}/prepare` failed with a generic 400 for
 * every task on a tenant with no policies at all -- exactly the opposite
 * of "no policies" meaning "nothing to check."
 *
 * Uses TENANT_B specifically: TENANT_A (every other fixture in this suite)
 * has two seeded policies, which is exactly why this was missed until a
 * real, policy-free tenant exercised it live.
 */

const BACKEND_SECRET_PREFIX = "authority_dk_";

function mintBackendSecret(): { plaintext: string; hash: string } {
  const plaintext = `${BACKEND_SECRET_PREFIX}${randomBytes(32).toString("hex")}`;
  return { plaintext, hash: createHash("sha256").update(plaintext).digest("hex") };
}

describe("backend-credential policy listing on a policy-free tenant (real database)", () => {
  const applicationIds: string[] = [];

  afterEach(async () => {
    for (const applicationId of applicationIds.splice(0, applicationIds.length)) {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.developer_backend_credentials where application_id = '${applicationId}';
        delete from public.customers where application_id = '${applicationId}';
        delete from public.applications where id = '${applicationId}';
      `);
    }
  });

  it("confirms TENANT_B genuinely has zero policies, then returns ok with an empty list -- not an error", async () => {
    const [{ count }] = (await managementQuery(
      `select count(*)::int as count from public.policies where tenant_id = '${TENANT_B_ID}';`,
    )) as Array<{ count: number }>;
    expect(count).toBe(0);

    const suffix = randomBytes(4).toString("hex");
    const applicationId = `eeee0000-0000-4000-8000-${suffix}0000`;
    const { plaintext: backendSecret, hash } = mintBackendSecret();
    await managementQuery(`
      insert into public.applications (id, tenant_id, name, slug, require_task_sessions) values ('${applicationId}', '${TENANT_B_ID}', 'Empty policies test app', 'epb-${suffix}', false);
      insert into public.developer_backend_credentials (tenant_id, application_id, key_prefix, key_hash)
      values ('${TENANT_B_ID}', '${applicationId}', '${backendSecret.slice(0, 21)}', '${hash}');
    `);
    applicationIds.push(applicationId);

    const customer = await createOrResolveCustomer({ credentialSecret: backendSecret, externalId: "alex" });
    expect(customer.status).toBe("ok");

    const result = await listActivePoliciesForBackend(backendSecret, TENANT_B_ID);
    expect(result.status).toBe("ok");
    expect(result.policies).toEqual([]);
  });
});
