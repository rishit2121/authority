import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { requestBrokerAccessToken } from "@/lib/connectors/broker/client";
import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import {
  createGmailConnector,
  defaultGmailConnectorDeps,
  GMAIL_CONNECTOR_ID,
} from "@/lib/connectors/gmail/connector";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";
import { sanitizeResource } from "@/lib/gateway/argument-audit";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";

import { closeGatewayPool } from "@/lib/gateway/db";

import { createGatewayFixture, currentVersions, type GatewayFixture } from "../gateway-support";
import { managementQuery, TENANT_A_ID } from "../support";
import {
  requestTestBrokerAccessToken,
  startMockBrokerServer,
  type MockBrokerServer,
} from "./mock-broker-server";

/**
 * Mode B (credential broker) exercised against a real local HTTP server
 * standing in for an application's own broker endpoint -- no external
 * broker or real Gmail credentials involved. Proves: a real connector
 * execution obtains a token scoped to the *correct* customer connection
 * (via `brokerConnectionRef`), nothing is cached or persisted locally
 * (every call re-asks the broker), and a broker-side rejection (bad
 * signature) surfaces as a clean, non-indeterminate connector failure --
 * same shape as gmail-connector.test.ts's managed-mode equivalents.
 *
 * The Gmail-API-call leg (list/send) is stubbed directly in this file
 * rather than reusing GmailFixtureApi (gmail-fixture-provider.ts), which
 * hardcodes rejection of any access token other than the literal
 * "fixture-access-token" -- a broker-mode token never matches that, by
 * design (broker mode never calls that fixture's own /token endpoint).
 */

let seq = 0;
const key = (p: string) => `${p}-${Date.now()}-${++seq}`;

function randomUuid(): string {
  const id = randomBytes(16).toString("hex");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
}

const actionsFor = (tools: string[]) =>
  JSON.stringify({ schemaVersion: 1, items: tools.map((tool) => ({ tool, constraints: [] })) });

interface GmailApiCall {
  path: string;
  authorization: string | undefined;
}

/** Stands in for Gmail's API itself -- accepts only the broker's own token shape, for the given ref. */
function makeBrokerGmailApiFetch(expectedRef: string) {
  const calls: GmailApiCall[] = [];
  const sentRaw: string[] = [];
  const fetchFn = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    calls.push({ path: input.url.pathname, authorization: input.headers.authorization });
    const expectedAuth = `Bearer mock-access-token-for-${expectedRef}`;
    if (input.headers.authorization !== expectedAuth) {
      return {
        status: 401,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: "invalid_grant" }),
        truncated: false,
      };
    }
    if (input.url.pathname === "/gmail/v1/users/me/messages/send") {
      const parsed = JSON.parse(input.body ?? "{}") as { raw?: string };
      if (parsed.raw) sentRaw.push(parsed.raw);
      return {
        status: 200,
        headers: new Headers(),
        bodyText: JSON.stringify({ id: "broker-msg-1" }),
        truncated: false,
      };
    }
    return { status: 404, headers: new Headers(), bodyText: "{}", truncated: false };
  };
  return { fetch: fetchFn, calls, sentRaw };
}

describe("Gmail connector, Mode B credential broker (real local broker server, real database)", () => {
  const BROKER_SECRET = `test-broker-secret-${randomBytes(24).toString("hex")}`;
  const applicationId = randomUuid();
  const customerId = randomUuid();
  const brokerId = randomUuid();
  const connectionId = randomUuid();
  const brokerConnectionRef = `broker-ref-${randomBytes(6).toString("hex")}`;

  let broker: MockBrokerServer;
  const fixtures: GatewayFixture[] = [];

  beforeAll(async () => {
    broker = await startMockBrokerServer({ secret: BROKER_SECRET });

    await managementQuery(`
      insert into public.applications (id, tenant_id, name, slug)
      values ('${applicationId}', '${TENANT_A_ID}', 'Broker test app', 'broker-test-${applicationId.slice(0, 8)}');

      insert into public.customers (id, tenant_id, application_id, external_id)
      values ('${customerId}', '${TENANT_A_ID}', '${applicationId}', 'broker-customer-1');

      insert into public.connection_brokers (id, tenant_id, application_id, url, secret_vault_id, status)
      values (
        '${brokerId}', '${TENANT_A_ID}', '${applicationId}',
        -- connection_brokers_url_check requires "https://" -- the real
        -- production shape. requestTestBrokerAccessToken (mock-broker-server.ts)
        -- rewrites it back to this same loopback address's real http:// scheme
        -- before dispatching, since the in-process mock server speaks plain HTTP.
        '${broker.url.replace(/^http:\/\//, "https://")}',
        vault.create_secret('${BROKER_SECRET}', 'test:broker:${brokerId}', 'gmail-broker.test.ts shared secret'),
        'active'
      );

      insert into public.connector_connections (
        id, tenant_id, connector_id, name, owner_kind, owner_customer_id, verified_account_ref,
        status, auth_mode, broker_id, broker_connection_ref
      ) values (
        '${connectionId}', '${TENANT_A_ID}', '${GMAIL_CONNECTOR_ID}', 'Broker connection', 'customer', '${customerId}',
        'broker-customer-1@example.com', 'active', 'broker', '${brokerId}', '${brokerConnectionRef}'
      );
    `);
  }, 60_000);

  afterEach(async () => {
    while (fixtures.length > 0) {
      const fx = fixtures.pop();
      if (!fx) continue;
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.connector_execution_receipts where task_id = '${fx.taskId}';
        delete from public.connector_reservations where task_id = '${fx.taskId}';
        delete from public.task_connector_bindings where task_id = '${fx.taskId}';
      `);
      await fx.cleanup();
    }
  });

  afterAll(async () => {
    await broker.stop();
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.connector_execution_receipts where connection_id = '${connectionId}';
      delete from public.connector_reservations where connection_id = '${connectionId}';
      delete from public.task_connector_bindings where connection_id = '${connectionId}';
      delete from public.connector_connections where id = '${connectionId}';
      delete from public.connection_brokers where id = '${brokerId}';
      delete from public.customers where id = '${customerId}';
      delete from public.applications where id = '${applicationId}';
    `);
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  const mkBoundTask = async (label: string, tools: string[]) => {
    const fx = await createGatewayFixture({ label, actions: actionsFor(tools), useCurrentVersions: true });
    fixtures.push(fx);
    await managementQuery(`update public.tasks set customer_id = '${customerId}' where id = '${fx.taskId}';`);
    const [bound] = (await managementQuery(
      `select gateway.bind_task_connector('${fx.tenantId}', '${fx.taskId}', '${GMAIL_CONNECTOR_ID}', '${connectionId}') as bind_task_connector;`,
    )) as Array<{ bind_task_connector: string }>;
    if (bound.bind_task_connector !== "ok") {
      throw new Error(`bind_task_connector: ${bound.bind_task_connector}`);
    }
    return fx;
  };

  async function runSend(fx: GatewayFixture, api: ReturnType<typeof makeBrokerGmailApiFetch>, to: string) {
    const args = { to, subject: "Broker end-to-end" };
    const decision = await authorizeThroughGateway({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tool: "gmail.send_email",
      operation: "send_email",
      // authorizeThroughGateway sanitizes the resource itself internally
      // (pipeline.ts); passing the raw address here matches
      // gmail-connector.test.ts's own authorize() helper.
      resource: to,
      arguments: args,
      idempotencyKey: key("auth"),
      ...currentVersions(),
    });
    expect(decision.kind).toBe("decision");
    if (decision.kind !== "decision" || !decision.capabilityToken) {
      throw new Error(`no capability: ${JSON.stringify(decision)}`);
    }
    resetConnectorRegistryForTests();
    registerConnector(
      createGmailConnector({
        ...defaultGmailConnectorDeps,
        fetch: api.fetch,
        requestBrokerToken: requestTestBrokerAccessToken,
      }),
    );
    return executeConnectorOperation(
      {
        credentialSecret: fx.secret,
        tokenHash: hashCapabilityToken(decision.capabilityToken),
        tool: "gmail.send_email",
        operation: "send_email",
        resource: sanitizeResource(to),
        args,
        idempotencyKey: key("exec"),
      },
      defaultConnectorExecutorDeps,
    );
  }

  it("authenticates to the real local broker, binds to the correct customer connection, and sends", async () => {
    const fx = await mkBoundTask("broker-success", ["gmail.send_email"]);
    const api = makeBrokerGmailApiFetch(brokerConnectionRef);
    const result = await runSend(fx, api, "customer@example.com");

    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({ id: "broker-msg-1" });
    expect(api.sentRaw).toHaveLength(1);
    const decoded = Buffer.from(api.sentRaw[0], "base64url").toString("utf8");
    expect(decoded).toContain("To: customer@example.com");

    // Exactly one signed request reached the real mock broker, carrying
    // this connection's own ref -- not some other connection's.
    expect(broker.requests).toHaveLength(1);
    const sentBody = JSON.parse(broker.requests[0].body) as {
      brokerConnectionRef?: string;
      connectorId?: string;
    };
    expect(sentBody.brokerConnectionRef).toBe(brokerConnectionRef);
    expect(sentBody.connectorId).toBe(GMAIL_CONNECTOR_ID);
  });

  it("never caches a broker token: two executions each ask the broker fresh", async () => {
    const fx = await mkBoundTask("broker-no-cache", ["gmail.send_email"]);
    const api = makeBrokerGmailApiFetch(brokerConnectionRef);
    const before = broker.requests.length;

    const first = await runSend(fx, api, "first@example.com");
    expect(first.http).toBe(200);
    const decision2 = await authorizeThroughGateway({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tool: "gmail.send_email",
      operation: "send_email",
      resource: "second@example.com",
      arguments: { to: "second@example.com", subject: "Broker end-to-end" },
      idempotencyKey: key("auth"),
      ...currentVersions(),
    });
    expect(decision2.kind).toBe("decision");
    if (decision2.kind !== "decision" || !decision2.capabilityToken) throw new Error("no capability");
    const second = await executeConnectorOperation(
      {
        credentialSecret: fx.secret,
        tokenHash: hashCapabilityToken(decision2.capabilityToken),
        tool: "gmail.send_email",
        operation: "send_email",
        resource: sanitizeResource("second@example.com"),
        args: { to: "second@example.com", subject: "Broker end-to-end" },
        idempotencyKey: key("exec"),
      },
      defaultConnectorExecutorDeps,
    );
    expect(second.http).toBe(200);

    expect(broker.requests.length - before).toBe(2);
  });

  it("a broker that rejects the signature fails the execution cleanly, before any send is attempted", async () => {
    const fx = await mkBoundTask("broker-bad-signature", ["gmail.send_email"]);
    const api = makeBrokerGmailApiFetch(brokerConnectionRef);
    const args = { to: "a@example.com", subject: "Broker end-to-end" };
    const decision = await authorizeThroughGateway({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tool: "gmail.send_email",
      operation: "send_email",
      resource: "a@example.com",
      arguments: args,
      idempotencyKey: key("auth"),
      ...currentVersions(),
    });
    expect(decision.kind).toBe("decision");
    if (decision.kind !== "decision" || !decision.capabilityToken) throw new Error("no capability");

    // A corrupted signing secret, standing in for a tampered/forged request --
    // the real client's own signing logic is exercised unmodified; only the
    // secret used to sign is wrong, so the real broker server's genuine HMAC
    // check is what rejects it (not a forced response).
    const corruptedClient: typeof requestTestBrokerAccessToken = (input) =>
      requestTestBrokerAccessToken({ ...input, brokerSecret: `${input.brokerSecret}-tampered` });
    resetConnectorRegistryForTests();
    registerConnector(
      createGmailConnector({
        ...defaultGmailConnectorDeps,
        fetch: api.fetch,
        requestBrokerToken: corruptedClient,
      }),
    );
    try {
      const before = api.calls.length;
      const result = await executeConnectorOperation(
        {
          credentialSecret: fx.secret,
          tokenHash: hashCapabilityToken(decision.capabilityToken),
          tool: "gmail.send_email",
          operation: "send_email",
          resource: sanitizeResource("a@example.com"),
          args,
          idempotencyKey: key("exec"),
        },
        defaultConnectorExecutorDeps,
      );
      // Obtaining a token has no side effect of its own -- a rejected
      // signature fails as a definite `failed` (502), never indeterminate,
      // and the Gmail API stub is never called at all.
      expect(result.http).toBe(502);
      expect((result.body.error as { code?: string }).code).toMatch(/^BROKER_TOKEN_/);
      expect(api.calls.length).toBe(before);

      // The receipt must actually be persisted, not silently dropped --
      // broker/client.ts's reason used to embed a raw HTTP status digit
      // (e.g. "BROKER_STATUS_401"), which connector_execution_receipts'
      // own reason_code check (`^[A-Z_]{1,60}$`) rejects outright, so the
      // whole settle() call failed and the receipt was never written.
      const receiptId = result.body.receiptId as string | null;
      expect(receiptId).toBeTruthy();
      const [receipt] = (await managementQuery(
        `select result_category, reason_code from public.connector_execution_receipts where id = '${receiptId}';`,
      )) as Array<{ result_category: string; reason_code: string }>;
      expect(receipt.result_category).toBe("failed");
      expect(receipt.reason_code).toMatch(/^[A-Z_]{1,60}$/);
    } finally {
      resetConnectorRegistryForTests();
      registerConnector(
        createGmailConnector({
          ...defaultGmailConnectorDeps,
          fetch: api.fetch,
          requestBrokerToken: requestTestBrokerAccessToken,
        }),
      );
    }
  });

  it("the mock broker itself rejects a stale timestamp and a replayed nonce (protocol-level, not Authority's own client)", async () => {
    // Authority's real client always sends the current time and a freshly
    // generated nonce -- it has no code path that would ever construct a
    // stale or repeated one itself. These two checks are the *broker's*
    // responsibility; this proves this mock implements them the way
    // docs/connectors/broker.md asks a real broker to, using the same
    // signing primitives the real client uses (requestTestBrokerAccessToken
    // mirrors it exactly), not a forced response.
    const staleWindowBroker = await startMockBrokerServer({ secret: BROKER_SECRET, windowSeconds: -1 });
    try {
      const stale = await requestTestBrokerAccessToken({
        brokerUrl: staleWindowBroker.url,
        brokerSecret: BROKER_SECRET,
        connectionId,
        connectorId: GMAIL_CONNECTOR_ID,
        brokerConnectionRef,
      });
      expect(stale).toMatchObject({ status: "error", reason: "BROKER_REJECTED" });
    } finally {
      await staleWindowBroker.stop();
    }

    const fixedNonce = randomBytes(16).toString("hex");
    const first = await requestTestBrokerAccessToken({
      brokerUrl: broker.url,
      brokerSecret: BROKER_SECRET,
      connectionId,
      connectorId: GMAIL_CONNECTOR_ID,
      brokerConnectionRef,
      nonceOverride: fixedNonce,
    });
    expect(first.status).toBe("ok");
    const replayed = await requestTestBrokerAccessToken({
      brokerUrl: broker.url,
      brokerSecret: BROKER_SECRET,
      connectionId,
      connectorId: GMAIL_CONNECTOR_ID,
      brokerConnectionRef,
      nonceOverride: fixedNonce,
    });
    expect(replayed).toMatchObject({ status: "error", reason: "BROKER_REJECTED" });
  });

  it("the real production broker client refuses a non-HTTPS loopback broker URL outright (SSRF guard, unmodified)", async () => {
    // Exercises src/lib/connectors/broker/client.ts's actual
    // requestBrokerAccessToken (not the test double above) to confirm the
    // same SSRF protection Custom API already relies on also covers Mode B:
    // an admin-registered broker URL that somehow pointed at a loopback/
    // internal address is refused before any network call is attempted.
    const before = broker.requests.length;
    const result = await requestBrokerAccessToken({
      brokerUrl: broker.url, // http://127.0.0.1:<port>/ -- not https, not port 443
      brokerSecret: BROKER_SECRET,
      connectionId,
      connectorId: GMAIL_CONNECTOR_ID,
      brokerConnectionRef,
    });
    expect(result).toMatchObject({ status: "error", reason: "BROKER_URL_INVALID" });
    // Rejected before any network call was even attempted.
    expect(broker.requests.length).toBe(before);
  });
});
