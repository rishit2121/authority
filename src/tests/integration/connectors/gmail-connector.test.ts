import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import { createGmailConnector, defaultGmailConnectorDeps } from "@/lib/connectors/gmail/connector";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { sanitizeResource } from "@/lib/gateway/argument-audit";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";

import { createGatewayFixture, currentVersions, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";
import { GmailFixtureApi } from "./gmail-fixture-provider";
import {
  ADMIN_A_USER_ID,
  closeGatewayPool,
  createGmailConnection,
  disconnectGmailConnection,
  setGmailRefreshToken,
  TENANT_A_ID,
  type GmailConnectionFixture,
} from "./gmail-support";

/**
 * The Gmail connector against the real database, with the one outbound HTTP
 * call (OAuth token refresh + the send itself) replaced by an in-memory
 * fixture (see gmail-fixture-provider.ts) -- same relationship
 * stripe-connector.test.ts has to StripeFixtureApi. The browser-redirect
 * OAuth dance (connect/callback routes) is not exercised here; see
 * gmail-support.ts's own comment on that scope boundary.
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
      // The real /api/v1/execute route sanitizes the resource before this
      // call (src/app/api/v1/execute/route.ts); an email address fails
      // sanitizeResource's clean-charset check ("@" is not allowed) and gets
      // redacted to a hash -- the capability recorded the SAME redacted form
      // at authorize time (pipeline.ts does this too), so this test must
      // sanitize identically or every email-shaped resource mismatches.
      resource: sanitizeResource(resource),
      args,
      idempotencyKey: idem,
    },
    defaultConnectorExecutorDeps,
  );
}

const actionsFor = (tools: string[]) =>
  JSON.stringify({ schemaVersion: 1, items: tools.map((tool) => ({ tool, constraints: [] })) });

describe("Gmail connector (in-memory fixture API, real database)", () => {
  let connection: GmailConnectionFixture;
  let fixtureApi: GmailFixtureApi;
  const fixtures: GatewayFixture[] = [];
  const REFRESH_TOKEN = "fixture-refresh-7a1c";

  const mkTask = async (label: string, tools: string[]) => {
    const fx = await createGatewayFixture({ label, actions: actionsFor(tools), useCurrentVersions: true });
    fixtures.push(fx);
    return fx;
  };

  beforeAll(async () => {
    // oauth.ts's own config check (fixture mode OR a real Google OAuth
    // client configured) runs independently of the injected `fetch` below --
    // it has no way to know a test double stands in for the real token
    // endpoint. Enabling fixture mode here satisfies that check; the actual
    // network call still goes through `fixtureApi.fetch`, never the real
    // fixture server, since it is passed explicitly as this connector's dep.
    process.env.GMAIL_FIXTURE_MODE = "1";

    fixtureApi = new GmailFixtureApi();

    resetConnectorRegistryForTests();
    registerConnector(createGmailConnector({ ...defaultGmailConnectorDeps, fetch: fixtureApi.fetch }));

    connection = await createGmailConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "gmail-test",
    });
    await setGmailRefreshToken(connection, REFRESH_TOKEN);
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
    delete process.env.GMAIL_FIXTURE_MODE;
    await connection?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  it("the allowed request: a correctly scoped capability refreshes a token, sends, and returns the fixture payload", async () => {
    const fx = await mkTask("allowed", ["gmail.send_email"]);
    const args = { to: "customer@example.com", subject: "Order update", body: "Your order has shipped." };
    const token = await authorize(fx, "gmail.send_email", args, "customer@example.com");
    const result = await run(fx, token, "gmail.send_email", args, "customer@example.com");
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({ id: "fixture-msg-1" });
    expect(fixtureApi.sentMessages).toHaveLength(1);
    const decoded = Buffer.from(fixtureApi.sentMessages[0].raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: customer@example.com");
    expect(decoded).toContain("Subject: Order update");
    expect(decoded).toContain("Your order has shipped.");
    // one /token refresh call, then one send call -- a fresh access token every time, nothing cached
    expect(fixtureApi.requests.map((r) => r.path)).toEqual(["/token", "/gmail/v1/users/me/messages/send"]);
  });

  it("list_messages: a correctly scoped capability lists messages across the mailbox", async () => {
    const fx = await mkTask("list-messages", ["gmail.list_messages"]);
    const args = { query: "is:unread" };
    const token = await authorize(fx, "gmail.list_messages", args, "inbox");
    const result = await run(fx, token, "gmail.list_messages", args, "inbox");
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({
      messages: [{ id: "fixture-msg-read-1", threadId: "fixture-thread-read-1" }],
    });
  });

  it("get_message: a correctly scoped capability returns the fixture message's content", async () => {
    const fx = await mkTask("get-message", ["gmail.get_message"]);
    const token = await authorize(
      fx,
      "gmail.get_message",
      { message_id: "fixture-msg-read-1" },
      "fixture-msg-read-1",
    );
    const ok = await run(
      fx,
      token,
      "gmail.get_message",
      { message_id: "fixture-msg-read-1" },
      "fixture-msg-read-1",
    );
    expect(ok.http).toBe(200);
    expect(ok.body.data).toMatchObject({
      id: "fixture-msg-read-1",
      snippet: "Hello from the fixture inbox.",
    });
  });

  it("get_message: a capability scoped to one message id cannot be replayed against a different one", async () => {
    const fx = await mkTask("get-message-blocked", ["gmail.get_message"]);
    const token = await authorize(
      fx,
      "gmail.get_message",
      { message_id: "fixture-msg-read-1" },
      "fixture-msg-read-1",
    );
    const blocked = await run(
      fx,
      token,
      "gmail.get_message",
      { message_id: "some-other-message" },
      "some-other-message",
    );
    expect(blocked.http).toBe(403);
    expect(blocked.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
  });

  it("list_labels: a correctly scoped capability lists the mailbox's labels", async () => {
    const fx = await mkTask("list-labels", ["gmail.list_labels"]);
    const token = await authorize(fx, "gmail.list_labels", {}, "labels");
    const result = await run(fx, token, "gmail.list_labels", {}, "labels");
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({ labels: [{ id: "INBOX" }, { id: "SENT" }] });
  });

  it("a header-injection attempt in the recipient is rejected before any request is built", async () => {
    const fx = await mkTask("header-injection", ["gmail.send_email"]);
    const args = { to: "victim@example.com\r\nBcc: attacker@evil.com", subject: "hi" };
    const token = await authorize(
      fx,
      "gmail.send_email",
      { to: "victim@example.com", subject: "hi" },
      "victim@example.com",
    );
    const before = fixtureApi.requests.length;
    const result = await run(fx, token, "gmail.send_email", args, "victim@example.com");
    // ARGUMENTS_INVALID from normalizeRequest, or SCOPE_MISMATCH since the
    // authorized resource no longer matches -- either way, never dispatched.
    expect(result.http).not.toBe(200);
    expect(fixtureApi.requests.length).toBe(before);
  });

  it("the blocked request: a capability scoped to one recipient cannot be replayed against a different one", async () => {
    const fx = await mkTask("blocked-resource", ["gmail.send_email"]);
    const token = await authorize(
      fx,
      "gmail.send_email",
      { to: "a@example.com", subject: "hi" },
      "a@example.com",
    );
    const before = fixtureApi.requests.length;
    const result = await run(
      fx,
      token,
      "gmail.send_email",
      { to: "b@example.com", subject: "hi" },
      "b@example.com",
    );
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before); // never dispatched
  });

  it("concurrent consumption: a single-use capability dispatched twice in parallel is honored exactly once", async () => {
    const fx = await mkTask("concurrent", ["gmail.send_email"]);
    const args = { to: "race@example.com", subject: "race" };
    const token = await authorize(fx, "gmail.send_email", args, "race@example.com", 1);
    const [a, b] = await Promise.all([
      run(fx, token, "gmail.send_email", args, "race@example.com", key("race")),
      run(fx, token, "gmail.send_email", args, "race@example.com", key("race")),
    ]);
    const outcomes = [a.http, b.http].sort();
    expect(outcomes[0]).toBe(200);
    expect([403, 409]).toContain(outcomes[1]); // CAPABILITY_ALREADY_USED or a RESERVATION_IN_PROGRESS race loser
    const successes = [a, b].filter((r) => r.http === 200);
    expect(successes).toHaveLength(1);
  });

  it("revocation: disconnecting the connection revokes an already-issued capability before it executes", async () => {
    // Only one active Gmail connection per tenant is supported
    // (connector_connections_one_active_per_connector), so this test
    // disconnects and recreates the shared one rather than standing up a
    // second connection alongside it.
    const fx = await mkTask("revocation", ["gmail.send_email"]);
    const args = { to: "a@example.com", subject: "hi" };
    const token = await authorize(fx, "gmail.send_email", args, "a@example.com");

    await disconnectGmailConnection(connection, ADMIN_A_USER_ID);
    try {
      const result = await run(fx, token, "gmail.send_email", args, "a@example.com");
      expect(result.http).not.toBe(200);
      expect((result.body.error as { code?: string } | undefined)?.code).toMatch(
        /REVOKED|CONNECTOR_NOT_CONFIGURED|CONNECTION_UNAVAILABLE/,
      );
    } finally {
      connection = await createGmailConnection({
        tenantId: TENANT_A_ID,
        adminUserId: ADMIN_A_USER_ID,
        label: "gmail-test",
      });
      await setGmailRefreshToken(connection, REFRESH_TOKEN);
    }
  });

  it("a revoked refresh token fails outright, before any write is attempted (never indeterminate)", async () => {
    const fx = await mkTask("revoked-refresh-token", ["gmail.send_email"]);
    const args = { to: "a@example.com", subject: "hi" };
    const token = await authorize(fx, "gmail.send_email", args, "a@example.com");

    fixtureApi.rejectRefreshToken = true;
    try {
      const before = fixtureApi.requests.length;
      const result = await run(fx, token, "gmail.send_email", args, "a@example.com");
      // Refreshing an access token has no side effect of its own, so this
      // settles as a definite failure -- never indeterminate -- and the send
      // endpoint is never called at all.
      expect(result.http).toBe(502);
      expect(result.body.error).toMatchObject({ code: "REFRESH_FAILED" });
      const since = fixtureApi.requests.slice(before);
      expect(since.filter((r) => r.path.includes("messages/send"))).toHaveLength(0);
      expect(since).toHaveLength(1); // the one /token attempt, nothing else
    } finally {
      fixtureApi.rejectRefreshToken = false;
    }
  });

  it("indeterminate writes: a send whose response never arrives settles as indeterminate, not failed or succeeded", async () => {
    const fx = await mkTask("indeterminate", ["gmail.send_email"]);
    const args = { to: "a@example.com", subject: "hi" };
    const token = await authorize(fx, "gmail.send_email", args, "a@example.com");

    // Only the send call hangs -- the token refresh (which happens first,
    // before beforeWrite()) must still resolve normally, or this would
    // exercise "the refresh hung" (a definite failure) instead of "the send
    // hung" (indeterminate), which is what this test means to prove.
    const hangingFetch: typeof fixtureApi.fetch = (input) =>
      input.url.pathname === "/token" ? fixtureApi.fetch(input) : new Promise(() => {});
    resetConnectorRegistryForTests();
    registerConnector(createGmailConnector({ ...defaultGmailConnectorDeps, fetch: hangingFetch }));
    try {
      const result = await executeConnectorOperation(
        {
          credentialSecret: fx.secret,
          tokenHash: hashCapabilityToken(token),
          tool: "gmail.send_email",
          operation: "send_email",
          resource: sanitizeResource("a@example.com"),
          args,
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
      registerConnector(createGmailConnector({ ...defaultGmailConnectorDeps, fetch: fixtureApi.fetch }));
    }
  });
});
