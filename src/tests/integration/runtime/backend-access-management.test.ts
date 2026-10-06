import { createHash, randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantConnectionAccessForBackend,
  listConnectionAccessForBackend,
  revokeConnectionAccessForBackend,
} from "@/lib/gateway/rpc-access-management";
import { createCustomerTask, createOrResolveCustomer } from "@/lib/gateway/rpc-customers";

import { createGatewayFixture, type GatewayFixture } from "../gateway-support";
import { managementQuery, TENANT_A_ID } from "../support";

/**
 * Proves 20261003000020's backend self-service access management: a
 * backend credential can grant/revoke a customer's use of a connection
 * ONLY when (a) that credential has been explicitly given
 * `can_manage_access` scope AND (b) an admin has explicitly marked that
 * exact connection `backend_grantable` for this application -- never by
 * the backend's own say-so, never widening past what the admin configured,
 * and never reachable by an agent runtime key (resolve_backend_credential
 * only ever matches a `developer_backend_credentials` secret).
 */

const BACKEND_SECRET_PREFIX = "authority_dk_";
const AGENT_SECRET_PREFIX = "authority_rk_";

function mintSecret(prefix: string): { plaintext: string; hash: string } {
  const plaintext = `${prefix}${randomBytes(32).toString("hex")}`;
  return { plaintext, hash: createHash("sha256").update(plaintext).digest("hex") };
}

interface AppFixture {
  applicationId: string;
  backendSecret: string;
  credentialId: string;
  cleanup: () => Promise<void>;
}

async function createApplicationFixture(suffix: string): Promise<AppFixture> {
  const applicationId = `dddd0000-0000-4000-8000-${suffix}0000`;
  const { plaintext, hash } = mintSecret(BACKEND_SECRET_PREFIX);
  const keyPrefix = plaintext.slice(0, 21);

  const rows = (await managementQuery(`
    insert into public.applications (id, tenant_id, name, slug)
    values ('${applicationId}', '${TENANT_A_ID}', 'Access management test app', 'bam-${suffix}');

    insert into public.developer_backend_credentials (tenant_id, application_id, key_prefix, key_hash)
    values ('${TENANT_A_ID}', '${applicationId}', '${keyPrefix}', '${hash}')
    returning id;
  `)) as Array<{ id: string }>;

  return {
    applicationId,
    backendSecret: plaintext,
    credentialId: rows[0].id,
    cleanup: async () => {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.backend_connection_access_grants where tenant_id = '${TENANT_A_ID}'
          and policy_id in (select id from public.application_connection_access_policies where application_id = '${applicationId}');
        delete from public.application_connection_access_policies where application_id = '${applicationId}';
        delete from public.connection_delegations where tenant_id = '${TENANT_A_ID}'
          and connection_id in (select id from public.connector_connections where name = 'access-mgmt test connection ${suffix}');
        delete from public.connector_connections where name = 'access-mgmt test connection ${suffix}';
        delete from public.developer_backend_credentials where application_id = '${applicationId}';
        delete from public.customers where application_id = '${applicationId}';
        delete from public.applications where id = '${applicationId}';
      `);
    },
  };
}

async function createOrgConnection(suffix: string): Promise<string> {
  const id = randomBytes(16).toString("hex");
  const connectionId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
  await managementQuery(`
    insert into public.connector_connections (id, tenant_id, connector_id, name, owner_kind, verified_account_ref, status)
    values ('${connectionId}', '${TENANT_A_ID}', 'slack', 'access-mgmt test connection ${suffix}', 'organization', 'access-mgmt-${suffix}', 'active');
  `);
  return connectionId;
}

async function setPolicy(
  applicationId: string,
  connectionId: string,
  scope: "backend_grantable" | "admin_only" | "application_shared",
): Promise<void> {
  await managementQuery(`
    insert into public.application_connection_access_policies (tenant_id, application_id, connection_id, scope)
    values ('${TENANT_A_ID}', '${applicationId}', '${connectionId}', '${scope}')
    on conflict (application_id, connection_id) do update set scope = excluded.scope;
  `);
}

async function setCanManageAccess(credentialId: string, value: boolean): Promise<void> {
  await managementQuery(`
    update public.developer_backend_credentials set can_manage_access = ${value} where id = '${credentialId}';
  `);
}

describe("backend self-service connection access management (real database)", () => {
  const apps: AppFixture[] = [];
  const fixtures: GatewayFixture[] = [];
  const taskIds: string[] = [];
  const connectionIds: string[] = [];

  afterEach(async () => {
    // Strict dependency order (same as customer-connections.test.ts's own
    // cleanupConnections): task_connector_bindings references both a task
    // and a connection, and connector_connections/tasks can each reference
    // a customer -- nothing downstream may be deleted before the rows that
    // reference it.
    if (connectionIds.length > 0) {
      const list = connectionIds
        .splice(0, connectionIds.length)
        .map((id) => `'${id}'`)
        .join(", ");
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.task_connector_bindings where connection_id in (${list});
        delete from public.backend_connection_access_grants where delegation_id in (
          select id from public.connection_delegations where connection_id in (${list})
        );
        delete from public.connection_delegations where connection_id in (${list});
        delete from public.application_connection_access_policies where connection_id in (${list});
        delete from public.connector_connections where id in (${list});
      `);
    }
    for (const taskId of taskIds.splice(0, taskIds.length)) {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.tasks where id = '${taskId}';
      `);
    }
    while (fixtures.length > 0) {
      await fixtures.pop()?.cleanup();
    }
    while (apps.length > 0) {
      await apps.pop()?.cleanup();
    }
  });

  it("refuses a grant when no policy exists for this connection at all", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const connectionId = await createOrgConnection(suffix);
    connectionIds.push(connectionId);
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });
    await setCanManageAccess(app.credentialId, true);

    const result = await grantConnectionAccessForBackend({
      credentialSecret: app.backendSecret,
      connectionId,
      customerId: customer.customerId!,
    });
    expect(result).toBe("not_in_envelope");
  });

  it("refuses a grant from a credential with no access-management scope, even when the connection is backend_grantable", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const connectionId = await createOrgConnection(suffix);
    connectionIds.push(connectionId);
    await setPolicy(app.applicationId, connectionId, "backend_grantable");
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });
    // can_manage_access defaults to false -- deliberately never enabled here.

    const result = await grantConnectionAccessForBackend({
      credentialSecret: app.backendSecret,
      connectionId,
      customerId: customer.customerId!,
    });
    expect(result).toBe("forbidden");
  });

  it("grants, lists, and revokes within the envelope -- idempotently -- and a never-granted customer sees nothing", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const connectionId = await createOrgConnection(suffix);
    connectionIds.push(connectionId);
    await setPolicy(app.applicationId, connectionId, "backend_grantable");
    await setCanManageAccess(app.credentialId, true);

    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });

    const first = await grantConnectionAccessForBackend({
      credentialSecret: app.backendSecret,
      connectionId,
      customerId: alex.customerId!,
    });
    expect(first).toBe("ok");

    // Idempotent: granting again must not create a second delegation row.
    const second = await grantConnectionAccessForBackend({
      credentialSecret: app.backendSecret,
      connectionId,
      customerId: alex.customerId!,
    });
    expect(second).toBe("ok");
    const delegationRows = await managementQuery(
      `select 1 from public.connection_delegations where connection_id = '${connectionId}' and customer_id = '${alex.customerId}' and revoked_at is null;`,
    );
    expect(delegationRows).toHaveLength(1);

    const alexList = await listConnectionAccessForBackend(app.backendSecret, alex.customerId!);
    expect(alexList.status).toBe("ok");
    expect(alexList.connections.map((c) => c.connectionId)).toEqual([connectionId]);

    // Bob was never granted anything -- the guard-row pattern still reports "ok" with zero real rows.
    const bobList = await listConnectionAccessForBackend(app.backendSecret, bob.customerId!);
    expect(bobList.status).toBe("ok");
    expect(bobList.connections).toEqual([]);

    const auditRow = (await managementQuery(
      `select granted_by_credential_id from public.backend_connection_access_grants bcag
       join public.connection_delegations cd on cd.id = bcag.delegation_id
       where cd.connection_id = '${connectionId}' and cd.customer_id = '${alex.customerId}';`,
    )) as Array<{ granted_by_credential_id: string }>;
    expect(auditRow).toHaveLength(1);
    expect(auditRow[0].granted_by_credential_id).toBe(app.credentialId);

    const revoked = await revokeConnectionAccessForBackend({
      credentialSecret: app.backendSecret,
      connectionId,
      customerId: alex.customerId!,
    });
    expect(revoked).toBe("ok");
    const afterRevokeList = await listConnectionAccessForBackend(app.backendSecret, alex.customerId!);
    expect(afterRevokeList.connections).toEqual([]);

    // Idempotent: revoking an already-revoked grant is still "ok", not an error.
    const revokedAgain = await revokeConnectionAccessForBackend({
      credentialSecret: app.backendSecret,
      connectionId,
      customerId: alex.customerId!,
    });
    expect(revokedAgain).toBe("ok");
  });

  it("stops granting the moment an admin changes the policy away from backend_grantable", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const connectionId = await createOrgConnection(suffix);
    connectionIds.push(connectionId);
    await setPolicy(app.applicationId, connectionId, "backend_grantable");
    await setCanManageAccess(app.credentialId, true);
    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });

    // An admin narrows the envelope back to admin_only.
    await setPolicy(app.applicationId, connectionId, "admin_only");

    const result = await grantConnectionAccessForBackend({
      credentialSecret: app.backendSecret,
      connectionId,
      customerId: alex.customerId!,
    });
    expect(result).toBe("not_in_envelope");
  });

  it("an agent runtime key can never call this -- it is not a developer_backend_credentials secret at all", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const connectionId = await createOrgConnection(suffix);
    connectionIds.push(connectionId);
    await setPolicy(app.applicationId, connectionId, "backend_grantable");
    await setCanManageAccess(app.credentialId, true);
    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });

    const { plaintext: agentSecret } = mintSecret(AGENT_SECRET_PREFIX);
    const result = await grantConnectionAccessForBackend({
      credentialSecret: agentSecret,
      connectionId,
      customerId: alex.customerId!,
    });
    expect(result).toBe("malformed");
  });

  it("application_shared lets every one of this application's customers use the connection with no per-customer delegation at all", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const connectionId = await createOrgConnection(suffix);
    connectionIds.push(connectionId);
    await setPolicy(app.applicationId, connectionId, "application_shared");

    const fx = await createGatewayFixture({ label: `access-shared-${suffix}` });
    fixtures.push(fx);

    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });

    // Neither customer was ever individually delegated this connection.
    for (const customer of [alex, bob]) {
      const created = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: customer.customerId!,
        agentId: fx.agentId,
        intent: "Use the shared connection",
        connectorBindings: [{ connectorId: "slack", connectionId }],
      });
      expect(created.status).toBe("ok");
      taskIds.push(created.taskId!);
    }
  });

  it("application_shared for one application never leaks access to a different application's customer, even in the same tenant", async () => {
    const suffix = randomBytes(4).toString("hex");
    const appA = await createApplicationFixture(suffix);
    apps.push(appA);
    const connectionId = await createOrgConnection(suffix);
    connectionIds.push(connectionId);
    await setPolicy(appA.applicationId, connectionId, "application_shared");

    const otherSuffix = randomBytes(4).toString("hex");
    const appB = await createApplicationFixture(otherSuffix);
    apps.push(appB);

    const fx = await createGatewayFixture({ label: `access-shared-cross-app-${suffix}` });
    fixtures.push(fx);

    const bobOnAppB = await createOrResolveCustomer({
      credentialSecret: appB.backendSecret,
      externalId: "bob",
    });
    const created = await createCustomerTask({
      credentialSecret: appB.backendSecret,
      customerId: bobOnAppB.customerId!,
      agentId: fx.agentId,
      intent: "Try the other application's shared connection",
      connectorBindings: [{ connectorId: "slack", connectionId }],
    });
    expect(created.status).toBe("connection_not_usable_by_customer");
    expect(created.taskId).toBeNull();
  });
});
