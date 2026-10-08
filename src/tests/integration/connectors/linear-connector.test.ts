import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createLinearConnector, defaultLinearConnectorDeps } from "@/lib/connectors/linear/connector";
import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";

import { createGatewayFixture, currentVersions, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";
import { LinearFixtureApi } from "./linear-fixture-provider";
import {
  ADMIN_A_USER_ID,
  TENANT_A_ID,
  closeGatewayPool,
  createLinearConnection,
  disconnectLinearConnection,
  setLinearApiKey,
  type LinearConnectionFixture,
} from "./linear-support";

/**
 * The Linear connector against the real database (reserve -> dispatch ->
 * settle, real two-phase gateway RPCs), with the one outbound HTTP call
 * replaced by an in-memory fixture API (see linear-fixture-provider.ts) --
 * the same relationship stripe-connector.test.ts has to StripeFixtureApi.
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

describe("Linear connector (in-memory fixture API, real database)", () => {
  let connection: LinearConnectionFixture;
  let fixtureApi: LinearFixtureApi;
  const fixtures: GatewayFixture[] = [];
  const API_KEY = "lin_api_fixture_7a1c";

  const mkTask = async (label: string, tools: string[]) => {
    const fx = await createGatewayFixture({ label, actions: actionsFor(tools), useCurrentVersions: true });
    fixtures.push(fx);
    return fx;
  };

  beforeAll(async () => {
    fixtureApi = new LinearFixtureApi();
    fixtureApi.requiredApiKey = API_KEY;

    resetConnectorRegistryForTests();
    registerConnector(createLinearConnector({ ...defaultLinearConnectorDeps, fetch: fixtureApi.fetch }));

    connection = await createLinearConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "linear-test",
    });
    await setLinearApiKey(connection, API_KEY);
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
    const fx = await mkTask("allowed", ["linear.get_issue"]);
    const token = await authorize(fx, "linear.get_issue", { issue_id: "issue_1demo" }, "issue_1demo");
    const result = await run(fx, token, "linear.get_issue", { issue_id: "issue_1demo" }, "issue_1demo");
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({ issue: { id: "issue_1demo", identifier: "ENG-1" } });
    expect(fixtureApi.requests.at(-1)?.query).toContain("issue(id:");
  });

  it("the blocked request: a capability scoped to one issue cannot be replayed against a different one", async () => {
    const fx = await mkTask("blocked-resource", ["linear.get_issue"]);
    const token = await authorize(fx, "linear.get_issue", { issue_id: "issue_1demo" }, "issue_1demo");
    const before = fixtureApi.requests.length;
    const result = await run(fx, token, "linear.get_issue", { issue_id: "issue_other" }, "issue_other");
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before); // never dispatched
  });

  it("wrong-operation substitution: a capability minted for get_issue cannot be redirected to create_issue", async () => {
    const fx = await mkTask("wrong-op", ["linear.get_issue", "linear.create_issue"]);
    const token = await authorize(fx, "linear.get_issue", { issue_id: "issue_1demo" }, "issue_1demo");
    const before = fixtureApi.requests.length;
    const result = await run(
      fx,
      token,
      "linear.create_issue",
      { team_id: "team_1demo", title: "Should not be created" },
      "team_1demo",
    );
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before);
    expect(fixtureApi.createdIssues).toHaveLength(0);
  });

  it("create_issue builds the exact GraphQL mutation and creates exactly one issue", async () => {
    const fx = await mkTask("create", ["linear.create_issue"]);
    const token = await authorize(
      fx,
      "linear.create_issue",
      { team_id: "team_1demo", title: "Fixture-created issue" },
      "team_1demo",
    );
    const result = await run(
      fx,
      token,
      "linear.create_issue",
      { team_id: "team_1demo", title: "Fixture-created issue" },
      "team_1demo",
    );
    expect(result.http).toBe(200);
    expect(fixtureApi.createdIssues).toHaveLength(1);
    expect(fixtureApi.createdIssues[0]).toMatchObject({
      teamId: "team_1demo",
      title: "Fixture-created issue",
    });
  });

  it("concurrent consumption: a single-use capability dispatched twice in parallel (different idempotency keys) is honored exactly once", async () => {
    const fx = await mkTask("concurrent", ["linear.get_issue"]);
    const token = await authorize(fx, "linear.get_issue", { issue_id: "issue_1demo" }, "issue_1demo", 1);
    const [a, b] = await Promise.all([
      run(fx, token, "linear.get_issue", { issue_id: "issue_1demo" }, "issue_1demo", key("race")),
      run(fx, token, "linear.get_issue", { issue_id: "issue_1demo" }, "issue_1demo", key("race")),
    ]);
    const outcomes = [a.http, b.http].sort();
    expect(outcomes[0]).toBe(200);
    expect([403, 409]).toContain(outcomes[1]); // CAPABILITY_ALREADY_USED or a RESERVATION_IN_PROGRESS race loser
    const successes = [a, b].filter((r) => r.http === 200);
    expect(successes).toHaveLength(1);
  });

  it("revocation: disconnecting the connection revokes an already-issued capability before it executes", async () => {
    // A tenant may have only one active Linear connection at a time, so this
    // test disconnects and recreates the shared one rather than standing up
    // a second connection alongside it.
    const fx = await mkTask("revocation", ["linear.get_issue"]);
    const token = await authorize(fx, "linear.get_issue", { issue_id: "issue_1demo" }, "issue_1demo");

    await disconnectLinearConnection(connection, ADMIN_A_USER_ID);
    try {
      const result = await run(fx, token, "linear.get_issue", { issue_id: "issue_1demo" }, "issue_1demo");
      expect(result.http).not.toBe(200);
      expect((result.body.error as { code?: string } | undefined)?.code).toMatch(
        /REVOKED|CONNECTOR_NOT_CONFIGURED|CONNECTION_UNAVAILABLE/,
      );
    } finally {
      await connection.cleanup();
      connection = await createLinearConnection({
        tenantId: TENANT_A_ID,
        adminUserId: ADMIN_A_USER_ID,
        label: "linear-test",
      });
      await setLinearApiKey(connection, API_KEY);
    }
  });

  it("GraphQL errors riding back on HTTP 200 settle as a definite failure, never a silent success", async () => {
    const fx = await mkTask("graphql-error", ["linear.get_issue"]);
    const token = await authorize(fx, "linear.get_issue", { issue_id: "issue_missing" }, "issue_missing");
    const result = await run(fx, token, "linear.get_issue", { issue_id: "issue_missing" }, "issue_missing");
    expect(result.http).not.toBe(200);
    expect(result.body.error).toMatchObject({ code: "UPSTREAM_CLIENT_ERROR" });
  });

  it("indeterminate writes: a create_issue whose response never arrives settles as indeterminate, not failed or succeeded", async () => {
    const fx = await mkTask("indeterminate", ["linear.create_issue"]);
    const token = await authorize(
      fx,
      "linear.create_issue",
      { team_id: "team_1demo", title: "Hanging" },
      "team_1demo",
    );

    const hangingFetch: typeof fixtureApi.fetch = () => new Promise(() => {}); // never resolves
    resetConnectorRegistryForTests();
    registerConnector(createLinearConnector({ ...defaultLinearConnectorDeps, fetch: hangingFetch }));
    try {
      const result = await executeConnectorOperation(
        {
          credentialSecret: fx.secret,
          tokenHash: hashCapabilityToken(token),
          tool: "linear.create_issue",
          operation: "create_issue",
          resource: "team_1demo",
          args: { team_id: "team_1demo", title: "Hanging" },
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
      registerConnector(createLinearConnector({ ...defaultLinearConnectorDeps, fetch: fixtureApi.fetch }));
    }
  });
});
