import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { createSlackConnector, defaultSlackConnectorDeps } from "@/lib/connectors/slack/connector";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";

import { createGatewayFixture, currentVersions, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";
import { SlackFixtureApi } from "./slack-fixture-provider";
import {
  ADMIN_A_USER_ID,
  TENANT_A_ID,
  closeGatewayPool,
  createSlackConnection,
  disconnectSlackConnection,
  setSlackBotToken,
  type SlackConnectionFixture,
} from "./slack-support";

/**
 * The Slack connector against the real database, with the one outbound HTTP
 * call replaced by an in-memory fixture API (see slack-fixture-provider.ts)
 * -- same relationship as stripe-connector.test.ts has to
 * StripeFixtureApi. Slack's own connector_id is the fixed string "slack",
 * so there is no cross-tenant connector-id substitution case here either
 * (see stripe-connector.test.ts's own comment on the same point).
 */

let seq = 0;
const key = (p: string) => `${p}-${Date.now()}-${++seq}`;

async function authorize(
  fx: GatewayFixture,
  tool: string,
  args: Record<string, string | number | boolean>,
  resource: string,
  maxUses = 1,
) {
  const r = await authorizeThroughGateway({
    credentialSecret: fx.secret,
    taskId: fx.taskId,
    tool,
    operation: tool.split(".").slice(1).join("."),
    resource,
    arguments: args,
    idempotencyKey: key("auth"),
    maxUses,
    ...currentVersions(),
  });
  if (r.kind !== "decision" || !r.capabilityToken) {
    throw new Error(
      `no capability for ${tool}: ${JSON.stringify(r.kind === "decision" ? r.commit.reasonCodes : r.kind === "failure" ? r.status : r.outcome)}`,
    );
  }
  return r.capabilityToken;
}

function run(
  fx: GatewayFixture,
  token: string,
  tool: string,
  args: Record<string, string | number | boolean>,
  resource: string,
  idem = key("exec"),
) {
  return executeConnectorOperation(
    {
      credentialSecret: fx.secret,
      tokenHash: hashCapabilityToken(token),
      tool,
      operation: tool.split(".").slice(1).join("."),
      resource,
      args,
      idempotencyKey: idem,
    },
    defaultConnectorExecutorDeps,
  );
}

const actionsFor = (tools: string[]) =>
  JSON.stringify({ schemaVersion: 1, items: tools.map((tool) => ({ tool, constraints: [] })) });

describe("Slack connector (in-memory fixture API, real database)", () => {
  let connection: SlackConnectionFixture;
  let fixtureApi: SlackFixtureApi;
  const fixtures: GatewayFixture[] = [];
  const BOT_TOKEN = "xoxb-fixture-7a1c";

  const mkTask = async (label: string, tools: string[]) => {
    const fx = await createGatewayFixture({ label, actions: actionsFor(tools), useCurrentVersions: true });
    fixtures.push(fx);
    return fx;
  };

  beforeAll(async () => {
    fixtureApi = new SlackFixtureApi();
    fixtureApi.requiredBotToken = BOT_TOKEN;

    resetConnectorRegistryForTests();
    registerConnector(createSlackConnector({ ...defaultSlackConnectorDeps, fetch: fixtureApi.fetch }));

    connection = await createSlackConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "slack-test",
    });
    await setSlackBotToken(connection, BOT_TOKEN);
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
    await connection?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  it("the allowed request: a correctly scoped capability posts to the fixture API and returns its payload", async () => {
    const fx = await mkTask("allowed", ["slack.post_message"]);
    const token = await authorize(
      fx,
      "slack.post_message",
      { channel: "C1DEMO", text: "deployment complete" },
      "C1DEMO",
    );
    const result = await run(
      fx,
      token,
      "slack.post_message",
      { channel: "C1DEMO", text: "deployment complete" },
      "C1DEMO",
    );
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({ ok: true, channel: "C1DEMO" });
    expect(fixtureApi.messages).toContainEqual(
      expect.objectContaining({ channel: "C1DEMO", text: "deployment complete" }),
    );
  });

  it("a read operation with no identifying argument still executes and is scoped by the connection alone", async () => {
    const fx = await mkTask("list-channels", ["slack.list_channels"]);
    const token = await authorize(fx, "slack.list_channels", {}, "workspace");
    const result = await run(fx, token, "slack.list_channels", {}, "workspace");
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({ ok: true });
    expect((result.body.data as { channels?: unknown[] }).channels).toHaveLength(2);
  });

  it("the blocked request: a capability scoped to one channel cannot be replayed against a different one", async () => {
    const fx = await mkTask("blocked-resource", ["slack.post_message"]);
    const token = await authorize(fx, "slack.post_message", { channel: "C1DEMO", text: "hi" }, "C1DEMO");
    const before = fixtureApi.requests.length;
    const result = await run(fx, token, "slack.post_message", { channel: "C2DEMO", text: "hi" }, "C2DEMO");
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before); // never dispatched
  });

  it("wrong-operation substitution: a capability minted for list_channels cannot be redirected to post_message", async () => {
    const fx = await mkTask("wrong-op", ["slack.list_channels", "slack.post_message"]);
    const token = await authorize(fx, "slack.list_channels", {}, "workspace");
    const before = fixtureApi.requests.length;
    const result = await run(fx, token, "slack.post_message", { channel: "C1DEMO", text: "hi" }, "C1DEMO");
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before);
  });

  it("concurrent consumption: a single-use capability dispatched twice in parallel is honored exactly once", async () => {
    const fx = await mkTask("concurrent", ["slack.post_message"]);
    const token = await authorize(fx, "slack.post_message", { channel: "C1DEMO", text: "race" }, "C1DEMO", 1);
    const [a, b] = await Promise.all([
      run(fx, token, "slack.post_message", { channel: "C1DEMO", text: "race" }, "C1DEMO", key("race")),
      run(fx, token, "slack.post_message", { channel: "C1DEMO", text: "race" }, "C1DEMO", key("race")),
    ]);
    const outcomes = [a.http, b.http].sort();
    expect(outcomes[0]).toBe(200);
    expect([403, 409]).toContain(outcomes[1]); // CAPABILITY_ALREADY_USED or a RESERVATION_IN_PROGRESS race loser
    const successes = [a, b].filter((r) => r.http === 200);
    expect(successes).toHaveLength(1);
  });

  it("a Slack-level error (ok: false with HTTP 200) is never treated as a success", async () => {
    const fx = await mkTask("slack-error", ["slack.post_message"]);
    const token = await authorize(
      fx,
      "slack.post_message",
      { channel: "C9MISSING", text: "hi" },
      "C9MISSING",
    );
    const result = await run(
      fx,
      token,
      "slack.post_message",
      { channel: "C9MISSING", text: "hi" },
      "C9MISSING",
    );
    // post_message is a write: beforeWrite() has already fired by the time
    // the connector learns Slack rejected it, so -- same as every other
    // connector here -- this settles as indeterminate, not a definite
    // failure (see stripe-connector.test.ts's own indeterminate-writes test
    // for the same rule).
    expect(result.http).toBe(504);
    expect(result.body.error).toMatchObject({ code: "EXECUTION_INDETERMINATE" });
    expect((result.body.error as { reason?: string } | undefined)?.reason).toBe(
      "SLACK_ERROR_CHANNEL_NOT_FOUND",
    );
    expect(result.body.status).toBe("indeterminate");
  });

  it("revocation: disconnecting the connection revokes an already-issued capability before it executes", async () => {
    // Only one active Slack connection per tenant is supported
    // (connector_connections_one_active_per_connector), so this test
    // disconnects and recreates the shared one rather than standing up a
    // second connection alongside it.
    const fx = await mkTask("revocation", ["slack.list_channels"]);
    const token = await authorize(fx, "slack.list_channels", {}, "workspace");

    await disconnectSlackConnection(connection, ADMIN_A_USER_ID);
    try {
      const result = await run(fx, token, "slack.list_channels", {}, "workspace");
      expect(result.http).not.toBe(200);
      expect((result.body.error as { code?: string } | undefined)?.code).toMatch(
        /REVOKED|CONNECTOR_NOT_CONFIGURED|CONNECTION_UNAVAILABLE/,
      );
    } finally {
      // The just-disconnected connection is no longer used by anything --
      // delete it before replacing `connection`, or it leaks as an orphaned
      // row (with its secret) forever, since afterAll only ever cleans up
      // whichever connection this variable currently points to.
      await connection.cleanup();
      connection = await createSlackConnection({
        tenantId: TENANT_A_ID,
        adminUserId: ADMIN_A_USER_ID,
        label: "slack-test",
      });
      await setSlackBotToken(connection, BOT_TOKEN);
    }
  });

  it("indeterminate writes: a post whose response never arrives settles as indeterminate, not failed or succeeded", async () => {
    const fx = await mkTask("indeterminate", ["slack.post_message"]);
    const token = await authorize(fx, "slack.post_message", { channel: "C1DEMO", text: "hi" }, "C1DEMO");

    const hangingFetch: typeof fixtureApi.fetch = () => new Promise(() => {}); // never resolves
    resetConnectorRegistryForTests();
    registerConnector(createSlackConnector({ ...defaultSlackConnectorDeps, fetch: hangingFetch }));
    try {
      const result = await executeConnectorOperation(
        {
          credentialSecret: fx.secret,
          tokenHash: hashCapabilityToken(token),
          tool: "slack.post_message",
          operation: "post_message",
          resource: "C1DEMO",
          args: { channel: "C1DEMO", text: "hi" },
          idempotencyKey: key("exec"),
        },
        { ...defaultConnectorExecutorDeps, deadlineMs: 150 },
      );
      expect(result.http).toBe(504);
      expect(result.body.error).toMatchObject({ code: "EXECUTION_INDETERMINATE" });
      expect(result.body.status).toBe("indeterminate");

      const [row] = (await managementQuery(
        `select result_category from public.connector_execution_receipts where execution_id = '${result.body.executionId}';`,
      )) as Array<{ result_category: string }>;
      expect(row?.result_category).toBe("indeterminate");
    } finally {
      resetConnectorRegistryForTests();
      registerConnector(createSlackConnector({ ...defaultSlackConnectorDeps, fetch: fixtureApi.fetch }));
    }
  });
});
