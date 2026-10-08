import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createNotionConnector, defaultNotionConnectorDeps } from "@/lib/connectors/notion/connector";
import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";

import { createGatewayFixture, currentVersions, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";
import { NotionFixtureApi } from "./notion-fixture-provider";
import {
  ADMIN_A_USER_ID,
  TENANT_A_ID,
  closeGatewayPool,
  createNotionConnection,
  disconnectNotionConnection,
  setNotionToken,
  type NotionConnectionFixture,
} from "./notion-support";

/**
 * The Notion connector against the real database (reserve -> dispatch ->
 * settle, real two-phase gateway RPCs), with the one outbound HTTP call
 * replaced by an in-memory fixture API (see notion-fixture-provider.ts) --
 * the same relationship stripe-connector.test.ts has to StripeFixtureApi.
 * `create_page` is the one test here that specifically proves the nested
 * JSON body (`parent.database_id`, `properties.Name.title[0].text.content`)
 * is built exactly as documented -- the shape Custom API's flat body model
 * cannot express at all.
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
      `no capability for ${tool}: ${JSON.stringify(r.kind === "decision" ? r.commit.reasonCodes : r.status)}`,
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

describe("Notion connector (in-memory fixture API, real database)", () => {
  let connection: NotionConnectionFixture;
  let fixtureApi: NotionFixtureApi;
  const fixtures: GatewayFixture[] = [];
  const TOKEN = "ntn_fixture_7a1c";

  const mkTask = async (label: string, tools: string[]) => {
    const fx = await createGatewayFixture({ label, actions: actionsFor(tools), useCurrentVersions: true });
    fixtures.push(fx);
    return fx;
  };

  beforeAll(async () => {
    fixtureApi = new NotionFixtureApi();
    fixtureApi.requiredToken = TOKEN;

    resetConnectorRegistryForTests();
    registerConnector(createNotionConnector({ ...defaultNotionConnectorDeps, fetch: fixtureApi.fetch }));

    connection = await createNotionConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "notion-test",
    });
    await setNotionToken(connection, TOKEN);
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

  it("the allowed request: a correctly scoped capability executes against the fixture API and returns its payload", async () => {
    const fx = await mkTask("allowed", ["notion.retrieve_page"]);
    const token = await authorize(fx, "notion.retrieve_page", { page_id: "page_1demo" }, "page_1demo");
    const result = await run(fx, token, "notion.retrieve_page", { page_id: "page_1demo" }, "page_1demo");
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({ id: "page_1demo", object: "page" });
    expect(fixtureApi.requests.at(-1)).toMatchObject({ method: "GET", path: "/v1/pages/page_1demo" });
    expect(fixtureApi.requests.at(-1)?.notionVersion).toBe("2022-06-28");
  });

  it("the blocked request: a capability scoped to one page cannot be replayed against a different one", async () => {
    const fx = await mkTask("blocked-resource", ["notion.retrieve_page"]);
    const token = await authorize(fx, "notion.retrieve_page", { page_id: "page_1demo" }, "page_1demo");
    const before = fixtureApi.requests.length;
    const result = await run(fx, token, "notion.retrieve_page", { page_id: "page_other" }, "page_other");
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before); // never dispatched
  });

  it("wrong-operation substitution: a capability minted for retrieve_page cannot be redirected to create_page", async () => {
    const fx = await mkTask("wrong-op", ["notion.retrieve_page", "notion.create_page"]);
    const token = await authorize(fx, "notion.retrieve_page", { page_id: "page_1demo" }, "page_1demo");
    const before = fixtureApi.requests.length;
    const result = await run(
      fx,
      token,
      "notion.create_page",
      { database_id: "db_1demo", title: "Should not be created" },
      "db_1demo",
    );
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before);
    expect(fixtureApi.createdPages).toHaveLength(0);
  });

  it("create_page builds the exact nested body (parent.database_id, properties.Name.title[0].text.content)", async () => {
    const fx = await mkTask("create", ["notion.create_page"]);
    const token = await authorize(
      fx,
      "notion.create_page",
      { database_id: "db_1demo", title: "Fixture-created page" },
      "db_1demo",
    );
    const result = await run(
      fx,
      token,
      "notion.create_page",
      { database_id: "db_1demo", title: "Fixture-created page" },
      "db_1demo",
    );
    expect(result.http).toBe(200);
    expect(fixtureApi.createdPages).toHaveLength(1);
    expect(fixtureApi.createdPages[0]).toMatchObject({
      databaseId: "db_1demo",
      title: "Fixture-created page",
    });
  });

  it("concurrent consumption: a single-use capability dispatched twice in parallel (different idempotency keys) is honored exactly once", async () => {
    const fx = await mkTask("concurrent", ["notion.retrieve_page"]);
    const token = await authorize(fx, "notion.retrieve_page", { page_id: "page_1demo" }, "page_1demo", 1);
    const [a, b] = await Promise.all([
      run(fx, token, "notion.retrieve_page", { page_id: "page_1demo" }, "page_1demo", key("race")),
      run(fx, token, "notion.retrieve_page", { page_id: "page_1demo" }, "page_1demo", key("race")),
    ]);
    const outcomes = [a.http, b.http].sort();
    expect(outcomes[0]).toBe(200);
    expect([403, 409]).toContain(outcomes[1]); // CAPABILITY_ALREADY_USED or a RESERVATION_IN_PROGRESS race loser
    const successes = [a, b].filter((r) => r.http === 200);
    expect(successes).toHaveLength(1);
  });

  it("revocation: disconnecting the connection revokes an already-issued capability before it executes", async () => {
    // A tenant may have only one active Notion connection at a time, so this
    // test disconnects and recreates the shared one rather than standing up
    // a second connection alongside it.
    const fx = await mkTask("revocation", ["notion.retrieve_page"]);
    const token = await authorize(fx, "notion.retrieve_page", { page_id: "page_1demo" }, "page_1demo");

    await disconnectNotionConnection(connection, ADMIN_A_USER_ID);
    try {
      const result = await run(fx, token, "notion.retrieve_page", { page_id: "page_1demo" }, "page_1demo");
      expect(result.http).not.toBe(200);
      expect((result.body.error as { code?: string } | undefined)?.code).toMatch(
        /REVOKED|CONNECTOR_NOT_CONFIGURED|CONNECTION_UNAVAILABLE/,
      );
    } finally {
      await connection.cleanup();
      connection = await createNotionConnection({
        tenantId: TENANT_A_ID,
        adminUserId: ADMIN_A_USER_ID,
        label: "notion-test",
      });
      await setNotionToken(connection, TOKEN);
    }
  });

  it("indeterminate writes: a create_page whose response never arrives settles as indeterminate, not failed or succeeded", async () => {
    const fx = await mkTask("indeterminate", ["notion.create_page"]);
    const token = await authorize(
      fx,
      "notion.create_page",
      { database_id: "db_1demo", title: "Hanging" },
      "db_1demo",
    );

    const hangingFetch: typeof fixtureApi.fetch = () => new Promise(() => {}); // never resolves
    resetConnectorRegistryForTests();
    registerConnector(createNotionConnector({ ...defaultNotionConnectorDeps, fetch: hangingFetch }));
    try {
      const result = await executeConnectorOperation(
        {
          credentialSecret: fx.secret,
          tokenHash: hashCapabilityToken(token),
          tool: "notion.create_page",
          operation: "create_page",
          resource: "db_1demo",
          args: { database_id: "db_1demo", title: "Hanging" },
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
      registerConnector(createNotionConnector({ ...defaultNotionConnectorDeps, fetch: fixtureApi.fetch }));
    }
  });
});
