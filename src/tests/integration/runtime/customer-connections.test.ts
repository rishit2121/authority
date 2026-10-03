import { createHash, randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";
import { reserveConnectorExecution } from "@/lib/gateway/rpc-connectors";
import {
  createCustomerTask,
  createOrResolveCustomer,
  listCustomerConnections,
} from "@/lib/gateway/rpc-customers";

import { createGatewayFixture, currentVersions, type GatewayFixture } from "../gateway-support";
import { managementQuery, TENANT_A_ID } from "../support";

/**
 * Proves the customer-isolation boundary added in
 * 20261003000001..000006: two customers can each hold their own connection
 * to the same provider, a task bound to one customer's connection can never
 * be steered onto the other's, and an unbound task's implicit first-use
 * binding refuses to guess when more than one organization-owned candidate
 * exists. Every row this suite creates (application, customers, backend
 * credential, connections) is inserted directly or through the real
 * developer-API RPCs -- never through a dashboard session, since none of
 * this is reachable from one.
 */

const BACKEND_SECRET_PREFIX = "authority_dk_";

function mintBackendSecret(): { plaintext: string; hash: string } {
  const plaintext = `${BACKEND_SECRET_PREFIX}${randomBytes(32).toString("hex")}`;
  return { plaintext, hash: createHash("sha256").update(plaintext).digest("hex") };
}

interface AppFixture {
  applicationId: string;
  backendSecret: string;
  cleanup: () => Promise<void>;
}

async function createApplicationFixture(suffix: string): Promise<AppFixture> {
  // The last UUID group needs 12 hex characters; `suffix` is 8 (4 random
  // bytes), so pad it out -- this was invisible as long as every call here
  // failed first with "function does not exist" against the unmigrated
  // schema, and only surfaced once a real `applications` table existed to
  // reject the malformed id.
  const applicationId = `aaaa0000-0000-4000-8000-${suffix}0000`;
  const { plaintext, hash } = mintBackendSecret();
  const keyPrefix = plaintext.slice(0, 21);

  await managementQuery(`
    insert into public.applications (id, tenant_id, name, slug)
    values ('${applicationId}', '${TENANT_A_ID}', 'Customer isolation test app', 'cit-${suffix}');

    insert into public.developer_backend_credentials (tenant_id, application_id, key_prefix, key_hash)
    values ('${TENANT_A_ID}', '${applicationId}', '${keyPrefix}', '${hash}');
  `);

  return {
    applicationId,
    backendSecret: plaintext,
    cleanup: async () => {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.developer_backend_credentials where application_id = '${applicationId}';
        delete from public.customers where application_id = '${applicationId}';
        delete from public.applications where id = '${applicationId}';
      `);
    },
  };
}

async function createOwnedConnection(options: {
  connectorId: string;
  ownerKind: "organization" | "customer";
  ownerCustomerId?: string;
  verifiedAccountRef: string;
}): Promise<string> {
  const id = randomBytes(16).toString("hex");
  const connectionId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
  await managementQuery(`
    insert into public.connector_connections (id, tenant_id, connector_id, name, owner_kind, owner_customer_id, verified_account_ref, status)
    values (
      '${connectionId}', '${TENANT_A_ID}', '${options.connectorId}', 'test connection',
      '${options.ownerKind}', ${options.ownerCustomerId ? `'${options.ownerCustomerId}'` : "null"},
      '${options.verifiedAccountRef}', 'active'
    );
  `);
  return connectionId;
}

async function bindTaskConnector(
  tenantId: string,
  taskId: string,
  connectorId: string,
  connectionId: string,
): Promise<string> {
  const rows = (await managementQuery(
    `select gateway.bind_task_connector('${tenantId}', '${taskId}', '${connectorId}', '${connectionId}') as bind_task_connector;`,
  )) as Array<{ bind_task_connector: string }>;
  return rows[0].bind_task_connector;
}

async function connectionUsableByCustomer(connectionId: string, customerId: string): Promise<boolean> {
  const rows = (await managementQuery(
    `select gateway.connection_usable_by_customer('${connectionId}', '${customerId}') as connection_usable_by_customer;`,
  )) as Array<{ connection_usable_by_customer: boolean }>;
  return rows[0].connection_usable_by_customer;
}

async function cleanupConnections(connectionIds: string[]): Promise<void> {
  if (connectionIds.length === 0) return;
  const list = connectionIds.map((id) => `'${id}'`).join(", ");
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.connector_reservations where connection_id in (${list});
    delete from public.task_connector_bindings where connection_id in (${list});
    delete from public.connection_delegations where connection_id in (${list});
    delete from public.connector_connections where id in (${list});
  `);
}

describe("customer connections (real database)", () => {
  const fixtures: GatewayFixture[] = [];
  const apps: AppFixture[] = [];
  const connectionIds: string[] = [];

  afterEach(async () => {
    // Strict dependency order: connections (and the bindings/reservations/
    // delegations pointing at them) first, then tasks (which may point at a
    // customer via tasks.customer_id), then the customers/application those
    // tasks and connections reference. Reversing any of these violates a
    // foreign key -- task_connector_bindings references both a task and a
    // connection, connector_connections and tasks can each reference a
    // customer, so nothing downstream may be deleted before them.
    await cleanupConnections(connectionIds.splice(0, connectionIds.length));
    while (fixtures.length > 0) {
      await fixtures.pop()?.cleanup();
    }
    while (apps.length > 0) {
      await apps.pop()?.cleanup();
    }
  });

  const mkFixture = async (label: string, actions?: string) => {
    const fx = await createGatewayFixture({ label, useCurrentVersions: true, actions });
    fixtures.push(fx);
    return fx;
  };

  it("two customers each resolve their own connection, never the other's", async () => {
    const app = await createApplicationFixture(randomBytes(4).toString("hex"));
    apps.push(app);

    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });
    expect(alex.status).toBe("ok");
    expect(bob.status).toBe("ok");
    expect(alex.customerId).toBeTruthy();
    expect(bob.customerId).not.toBe(alex.customerId);

    const connectorId = `gmailtest${randomBytes(3).toString("hex")}`;
    const alexConnection = await createOwnedConnection({
      connectorId,
      ownerKind: "customer",
      ownerCustomerId: alex.customerId!,
      verifiedAccountRef: "alex@example.com",
    });
    const bobConnection = await createOwnedConnection({
      connectorId,
      ownerKind: "customer",
      ownerCustomerId: bob.customerId!,
      verifiedAccountRef: "bob@example.com",
    });
    connectionIds.push(alexConnection, bobConnection);

    const alexList = await listCustomerConnections({
      credentialSecret: app.backendSecret,
      customerId: alex.customerId!,
    });
    expect(alexList.status).toBe("ok");
    expect(alexList.connections.map((c) => c.connectionId)).toEqual([alexConnection]);

    const bobList = await listCustomerConnections({
      credentialSecret: app.backendSecret,
      customerId: bob.customerId!,
    });
    expect(bobList.connections.map((c) => c.connectionId)).toEqual([bobConnection]);
  });

  it("a customer-scoped task created with another customer's connection is refused, and no task is created", async () => {
    const app = await createApplicationFixture(randomBytes(4).toString("hex"));
    apps.push(app);
    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });

    const connectorId = `gmailtest${randomBytes(3).toString("hex")}`;
    const bobConnection = await createOwnedConnection({
      connectorId,
      ownerKind: "customer",
      ownerCustomerId: bob.customerId!,
      verifiedAccountRef: "bob@example.com",
    });
    connectionIds.push(bobConnection);

    const fx = await mkFixture("customer-task-forged-connection");

    const result = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: alex.customerId!,
      agentId: fx.agentId,
      intent: "Read Alex's inbox",
      connectorBindings: [{ connectorId, connectionId: bobConnection }],
    });

    expect(result.status).toBe("connection_not_usable_by_customer");
    expect(result.taskId).toBeNull();
  });

  it("a task bound to one customer's connection resolves and reserves against exactly that connection", async () => {
    const app = await createApplicationFixture(randomBytes(4).toString("hex"));
    apps.push(app);
    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });

    const connectorId = `gmailtest${randomBytes(3).toString("hex")}`;
    const alexConnection = await createOwnedConnection({
      connectorId,
      ownerKind: "customer",
      ownerCustomerId: alex.customerId!,
      verifiedAccountRef: "alex@example.com",
    });
    const bobConnection = await createOwnedConnection({
      connectorId,
      ownerKind: "customer",
      ownerCustomerId: bob.customerId!,
      verifiedAccountRef: "bob@example.com",
    });
    connectionIds.push(alexConnection, bobConnection);

    const fx = await mkFixture(
      "customer-task-bound",
      `{"schemaVersion":1,"items":[{"tool":"${connectorId}.send_email","constraints":[]}]}`,
    );
    await managementQuery(
      `update public.tasks set customer_id = '${alex.customerId}' where id = '${fx.taskId}';`,
    );
    const bindResult = await bindTaskConnector(fx.tenantId, fx.taskId, connectorId, alexConnection);
    expect(bindResult).toBe("ok");

    const decision = await authorizeThroughGateway({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tool: `${connectorId}.send_email`,
      operation: "send_email",
      arguments: {},
      idempotencyKey: `auth-${randomBytes(4).toString("hex")}`,
      ...currentVersions(),
    });
    expect(decision.kind).toBe("decision");
    if (decision.kind !== "decision") return;
    expect(decision.commit.finalOutcome).toBe("allow");
    expect(decision.capabilityToken).toBeTruthy();

    const reservation = await reserveConnectorExecution({
      credentialSecret: fx.secret,
      tokenHash: hashCapabilityToken(decision.capabilityToken!),
      tool: `${connectorId}.send_email`,
      operation: "send_email",
      resource: null,
      args: {},
      idempotencyKey: `exec-${randomBytes(4).toString("hex")}`,
      executionMode: "mock",
      leaseSeconds: 30,
    });

    expect(reservation.status).toBe("ok");
    expect(reservation.result).toBe("reserved");
    expect(reservation.connectionId).toBe(alexConnection);
    expect(reservation.connectionId).not.toBe(bobConnection);
  });

  it("binding a customer-scoped task to a connection owned by a different customer is refused", async () => {
    const app = await createApplicationFixture(randomBytes(4).toString("hex"));
    apps.push(app);
    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });

    const connectorId = `gmailtest${randomBytes(3).toString("hex")}`;
    const bobConnection = await createOwnedConnection({
      connectorId,
      ownerKind: "customer",
      ownerCustomerId: bob.customerId!,
      verifiedAccountRef: "bob@example.com",
    });
    connectionIds.push(bobConnection);

    const fx = await mkFixture("customer-task-cross-bind");
    await managementQuery(
      `update public.tasks set customer_id = '${alex.customerId}' where id = '${fx.taskId}';`,
    );

    const bindResult = await bindTaskConnector(fx.tenantId, fx.taskId, connectorId, bobConnection);
    expect(bindResult).toBe("connection_not_usable_by_customer");
  });

  it("an organization connection delegated to a customer is usable by them, and not usable once revoked", async () => {
    const app = await createApplicationFixture(randomBytes(4).toString("hex"));
    apps.push(app);
    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });

    const connectorId = `gmailtest${randomBytes(3).toString("hex")}`;
    const sharedConnection = await createOwnedConnection({
      connectorId,
      ownerKind: "organization",
      verifiedAccountRef: "shared@example.com",
    });
    connectionIds.push(sharedConnection);

    const fx = await mkFixture("customer-task-delegation");
    await managementQuery(
      `update public.tasks set customer_id = '${alex.customerId}' where id = '${fx.taskId}';`,
    );

    // Not delegated yet -- the connection exists, but this customer may not use it.
    const beforeDelegation = await bindTaskConnector(fx.tenantId, fx.taskId, connectorId, sharedConnection);
    expect(beforeDelegation).toBe("connection_not_usable_by_customer");

    await managementQuery(`
      insert into public.connection_delegations (tenant_id, connection_id, customer_id)
      values ('${fx.tenantId}', '${sharedConnection}', '${alex.customerId}');
    `);

    const afterDelegation = await bindTaskConnector(fx.tenantId, fx.taskId, connectorId, sharedConnection);
    expect(afterDelegation).toBe("ok");

    await managementQuery(`
      update public.connection_delegations set revoked_at = now()
      where connection_id = '${sharedConnection}' and customer_id = '${alex.customerId}';
    `);

    const usable = await connectionUsableByCustomer(sharedConnection, alex.customerId!);
    expect(usable).toBe(false);
  });

  it("an unbound task refuses to guess when more than one organization connection exists for the same connector", async () => {
    const connectorId = `ambtest${randomBytes(4).toString("hex")}`;
    const first = await createOwnedConnection({
      connectorId,
      ownerKind: "organization",
      verifiedAccountRef: "org-account-1",
    });
    const second = await createOwnedConnection({
      connectorId,
      ownerKind: "organization",
      verifiedAccountRef: "org-account-2",
    });
    connectionIds.push(first, second);

    const fx = await mkFixture(
      "ambiguous-connection",
      `{"schemaVersion":1,"items":[{"tool":"${connectorId}.do_thing","constraints":[]}]}`,
    );

    const decision = await authorizeThroughGateway({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tool: `${connectorId}.do_thing`,
      operation: "do_thing",
      arguments: {},
      idempotencyKey: `auth-${randomBytes(4).toString("hex")}`,
      ...currentVersions(),
    });
    expect(decision.kind).toBe("decision");
    if (decision.kind !== "decision") return;
    expect(decision.capabilityToken).toBeTruthy();

    const reservation = await reserveConnectorExecution({
      credentialSecret: fx.secret,
      tokenHash: hashCapabilityToken(decision.capabilityToken!),
      tool: `${connectorId}.do_thing`,
      operation: "do_thing",
      resource: null,
      args: {},
      idempotencyKey: `exec-${randomBytes(4).toString("hex")}`,
      executionMode: "mock",
      leaseSeconds: 30,
    });

    expect(reservation.result).toBe("rejected");
    expect(reservation.reasonCode).toBe("AMBIGUOUS_CONNECTOR_CONNECTION");
  });
});
