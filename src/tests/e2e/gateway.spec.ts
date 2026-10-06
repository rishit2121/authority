import { createHash } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  createGatewayFixture,
  resetSemanticSettings,
  type GatewayFixture,
} from "../integration/gateway-support";
import { managementQuery } from "../integration/support";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * Part 6 through the real HTTP API and UI: bypass attempts with the anonymous
 * key, the authorize -> consume -> replay -> revoke lifecycle, the stable error
 * contract, argument privacy at rest, and the dashboard's capability view.
 * pgTAP suite 19 and the integration tests cover the matrix directly against
 * the database; this spec proves the real routes and pages are wired to it.
 */
test.describe.serial("trusted gateway", () => {
  let fx: GatewayFixture;
  const ACTIONS =
    '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]},{"tool":"github.create_branch","constraints":[{"key":"branch","matches":"fix-*"}]},{"tool":"gmail.send_email","constraints":[]}]}';
  // github.* tools are executed by the real connector (see github-connector.spec.ts); simulated
  // consumption is only for tools no connector runs, so these lifecycle tests use gmail.send_email.
  const SIM = { tool: "gmail.send_email", operation: "send_email" };

  const authorize = (
    request: APIRequestContext,
    key: string,
    args: Record<string, unknown> = { issue_number: "1" },
    extra: Record<string, unknown> = {},
    bearer = fx.secret,
  ) =>
    request.post("/api/v1/authorize", {
      headers: { authorization: `Bearer ${bearer}` },
      data: {
        taskId: fx.taskId,
        tool: "github.get_issue",
        operation: "get_issue",
        arguments: args,
        idempotencyKey: key,
        ...extra,
      },
    });

  const consume = (
    request: APIRequestContext,
    capability: string,
    key: string,
    args: Record<string, unknown> = { issue_number: "1" },
    extra: Record<string, unknown> = {},
    bearer = fx.secret,
  ) =>
    request.post("/api/v1/capabilities/consume", {
      headers: { authorization: `Bearer ${bearer}` },
      data: {
        capability,
        tool: "github.get_issue",
        operation: "get_issue",
        arguments: args,
        idempotencyKey: key,
        ...extra,
      },
    });

  test.beforeAll(async () => {
    await resetSemanticSettings();
    fx = await createGatewayFixture({
      label: "gw-e2e",
      actions: ACTIONS,
      maxToolInvocations: 200,
      forbiddenResources: '{"secret-*"}',
      // "tenant", not `true`: this suite calls the real /api/v1/authorize
      // route, which authorizes through buildTenantRegistry(tenantId)
      // internally, not the bare fixture file -- the contract must match.
      useCurrentVersions: "tenant",
      // Explicit, as github-connector.spec.ts's UI-driven binding is: this suite only issues
      // github.* capabilities (never dispatches them through the real connector — see the
      // comment on SIM above), but an explicit bind keeps this fixture from depending on
      // however many repositories happen to be seeded on the shared mock installation.
      githubRepo: "acme/widgets",
    });
  });

  test.afterAll(async () => {
    await fx.cleanup();
    await resetSemanticSettings();
  });

  test("the anonymous key cannot reach any runtime RPC, even with a valid agent key", async ({ request }) => {
    for (const [fn, body] of [
      ["authorize_tool_call", { p_credential_secret: fx.secret, p_task_id: fx.taskId }],
      ["get_semantic_evaluation_context", { p_credential_secret: fx.secret, p_decision_id: fx.taskId }],
      ["record_semantic_shadow", { p_credential_secret: fx.secret, p_decision_id: fx.taskId }],
      ["record_agent_auth_failure", { p_credential_secret: fx.secret }],
    ] as const) {
      const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        headers: {
          apikey: ANON_KEY,
          authorization: `Bearer ${ANON_KEY}`,
          "content-type": "application/json",
        },
        data: body,
      });
      // PostgREST no longer even exposes these functions to the anonymous role.
      expect([401, 403, 404]).toContain(response.status());
      expect(await response.text()).not.toContain("decision");
    }
    const schema = await request.post(`${SUPABASE_URL}/rest/v1/rpc/ping`, {
      headers: { apikey: ANON_KEY, "content-profile": "gateway", "content-type": "application/json" },
      data: {},
    });
    expect([401, 403, 404, 406]).toContain(schema.status());
  });

  test("health is live and readiness proves the gateway credential works", async ({ request }) => {
    expect((await request.get("/api/v1/health")).status()).toBe(200);
    const ready = await request.get("/api/v1/ready");
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toMatchObject({ status: "ready", github: "mock" });
  });

  test("authorize issues a short-lived capability once, with no-store caching", async ({ request }) => {
    const response = await authorize(request, "gw-1");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-request-id"]).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("allow");
    expect(body.simulation).toBe(false); // github.* is executed by a real connector
    expect(body.capability.token).toMatch(/^authcap_v1_/);
    const ttl = (new Date(body.capability.expiresAt).getTime() - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(61);

    const hash = createHash("sha256").update(body.capability.token).digest("hex");
    const stored = (await managementQuery(
      `select count(*)::int as n,
              (select count(*)::int from public.capability_tokens ct where ct::text like '%${body.capability.token}%') as plaintext_rows
         from public.capability_tokens where token_hash = '${hash}';`,
    )) as Array<{ n: number; plaintext_rows: number }>;
    expect(stored[0].n).toBe(1);
    expect(stored[0].plaintext_rows).toBe(0);
  });

  test("consume: accepted once (simulated), idempotent on retry, and a replay is rejected", async ({
    request,
  }) => {
    const issued = await (await authorize(request, "gw-2", { issue_number: "1" }, SIM)).json();
    const token = issued.capability.token as string;

    const first = await consume(request, token, "use-1", { issue_number: "1" }, SIM);
    expect(first.status()).toBe(200);
    expect(await first.json()).toMatchObject({
      result: "accepted",
      simulated: true,
      remainingUses: 0,
      replayed: false,
    });

    const retry = await consume(request, token, "use-1", { issue_number: "1" }, SIM);
    expect(retry.status()).toBe(200);
    expect((await retry.json()).replayed).toBe(true);

    const replay = await consume(request, token, "use-2", { issue_number: "1" }, SIM);
    expect(replay.status()).toBe(409);
    expect((await replay.json()).error.code).toBe("CAPABILITY_ALREADY_USED");

    const conflict = await consume(request, token, "use-1", { issue_number: "2" }, SIM);
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("a capability cannot authorize a different tool, resource or argument than it was issued for", async ({
    request,
  }) => {
    const issued = await (await authorize(request, "gw-3", { issue_number: "1" }, SIM)).json();
    const token = issued.capability.token as string;

    const wrongArg = await consume(request, token, "x-1", { issue_number: "2" }, SIM);
    expect(wrongArg.status()).toBe(403);
    expect((await wrongArg.json()).error.code).toBe("SCOPE_MISMATCH");
    const wrongTool = await consume(
      request,
      token,
      "x-2",
      { issue_number: "1" },
      { tool: "github.create_branch" },
    );
    expect(wrongTool.status()).toBe(403);
    const wrongResource = await consume(
      request,
      token,
      "x-3",
      { issue_number: "1" },
      { ...SIM, resource: "other" },
    );
    expect(wrongResource.status()).toBe(403);
    // None of those attempts spent the capability.
    expect((await consume(request, token, "x-ok", { issue_number: "1" }, SIM)).status()).toBe(200);
  });

  test("a malformed or unknown capability, and a missing key, get the stable error contract", async ({
    request,
  }) => {
    expect((await consume(request, "authcap_v1_short", "m-1")).status()).toBe(400);
    const unknown = await consume(request, `authcap_v1_${"A".repeat(43)}`, "m-2");
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).error.code).toBe("CAPABILITY_NOT_FOUND");
    const noKey = await request.post("/api/v1/capabilities/consume", { data: {} });
    expect(noKey.status()).toBe(401);
    expect((await noKey.json()).error.code).toBe("UNAUTHENTICATED");
  });

  test("a denied request is recorded but receives no capability; the response is generic", async ({
    request,
  }) => {
    const denied = await authorize(request, "gw-4", { issue_number: "1", note: "secret-vault" });
    const body = await denied.json();
    expect(denied.status()).toBe(200);
    expect(body.status).toBe("deny");
    expect(body.capability).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/secret-\*|pattern|glob/i);
  });

  test("agents can revoke their own capability; a revoked capability is rejected", async ({ request }) => {
    const issued = await (await authorize(request, "gw-5", { issue_number: "1" }, SIM)).json();
    const revoke = await request.post("/api/v1/capabilities/revoke", {
      headers: { authorization: `Bearer ${fx.secret}` },
      data: { capabilityId: issued.capability.id, reason: "not needed" },
    });
    expect(revoke.status()).toBe(200);
    expect((await revoke.json()).result).toBe("revoked");
    const again = await request.post("/api/v1/capabilities/revoke", {
      headers: { authorization: `Bearer ${fx.secret}` },
      data: { capabilityId: issued.capability.id, reason: "again" },
    });
    expect((await again.json()).result).toBe("already_revoked");
    const use = await consume(request, issued.capability.token, "r-1", { issue_number: "1" }, SIM);
    expect(use.status()).toBe(409);
    expect((await use.json()).error.code).toBe("CAPABILITY_REVOKED");
  });

  test("an idempotent authorize retry returns the same decision and never a second token", async ({
    request,
  }) => {
    const first = await (await authorize(request, "gw-6")).json();
    const second = await (await authorize(request, "gw-6")).json();
    expect(second.decisionId).toBe(first.decisionId);
    expect(second.wasReplayed).toBe(true);
    expect(second.capability.token).toBeNull();
    expect(second.capability.id).toBe(first.capability.id);
    const conflict = await authorize(request, "gw-6", { issue_number: "9" });
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("oversized payloads and unknown fields are refused without echoing them", async ({ request }) => {
    const tooBig = await authorize(request, "gw-7", { a: "x".repeat(70_000) });
    expect(tooBig.status()).toBe(413);
    const extra = await authorize(request, "gw-8", { issue_number: "1" }, { tenantId: "anything" });
    expect(extra.status()).toBe(400);
    const wide = await authorize(
      request,
      "gw-9",
      Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, "v"])),
    );
    expect(wide.status()).toBe(413);
  });

  test("raw arguments and secrets are never stored, and the secrets never come back", async ({ request }) => {
    const sentinel = "PLAYWRIGHT-RAW-SENTINEL-77";
    const token = "ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6";
    const response = await authorize(request, "gw-10", { issue_number: "1", body: `${sentinel} ${token}` });
    const text = await response.text();
    expect(text).not.toContain(sentinel);
    expect(text).not.toContain(token);
    expect(text).not.toContain(fx.secret);

    const rows = (await managementQuery(
      `select count(*)::int as n from public.tool_requests where task_id = '${fx.taskId}'
         and (tool_requests::text like '%${sentinel}%' or tool_requests::text like '%ghp_aB3d%');`,
    )) as Array<{ n: number }>;
    expect(rows[0].n).toBe(0);
    const audit = (await managementQuery(
      `select arguments_redacted, argument_audit -> 'entries' as entries from public.tool_requests where task_id = '${fx.taskId}' and idempotency_key = 'gw-10';`,
    )) as Array<{ arguments_redacted: boolean; entries: Array<{ key: string; value?: string }> }>;
    expect(audit[0].arguments_redacted).toBe(true);
    expect(audit[0].entries.find((e) => e.key === "body")?.value).toBeUndefined();
    expect(audit[0].entries.find((e) => e.key === "issue_number")?.value).toBe("1");
  });

  test("repeated bad keys are rate limited with Retry-After, and the attempts are audited", async ({
    request,
  }) => {
    const bad = `authority_rk_${"ab".repeat(4)}${"0".repeat(56)}`;
    let limited = 0;
    let retryAfter: string | undefined;
    for (let i = 0; i < 24; i += 1) {
      const r = await authorize(request, `rl-${i}`, { issue_number: "1" }, {}, bad);
      if (r.status() === 429) {
        limited += 1;
        retryAfter = r.headers()["retry-after"];
      } else {
        expect(r.status()).toBe(401);
      }
    }
    expect(limited).toBeGreaterThan(0);
    expect(retryAfter).toBe("60");
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.agent_auth_events where attempted_key_prefix = '${bad.slice(0, 21)}';
    `);
  });

  test("the runtime dashboard shows capability state, remaining uses, replay attempts and the simulation label", async ({
    page,
  }) => {
    await page.goto(`/app/runtime?agentId=${fx.agentId}`);
    await expect(page.getByTestId("simulation-notice")).toContainText("no external tool was executed");
    const replayed = page.getByTestId("capability-cell").filter({ hasText: "replay attempt" }).first();
    await expect(replayed).toContainText("consumed");
    await expect(replayed).toContainText("0/1 uses left");
    await expect(replayed).toContainText("1 simulated use");
    await expect(
      page
        .getByTestId("runtime-row")
        .filter({ has: page.getByText("revoked", { exact: true }) })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("runtime-row")
        .filter({ has: page.getByText("none", { exact: true }) })
        .first(),
    ).toBeVisible();

    await page.goto(`/app/runtime?agentId=${fx.agentId}&capability=active`);
    const active = page.getByTestId("runtime-row").first();
    await expect(active.getByTestId("capability-cell")).toContainText("s left");
  });

  test("an admin can revoke an active capability from the dashboard", async ({ page, request }) => {
    const issued = await (await authorize(request, "gw-admin-revoke", { issue_number: "1" }, SIM)).json();
    await page.goto(`/app/runtime?agentId=${fx.agentId}&capability=active`);
    await page.getByRole("button", { name: "Revoke capability" }).first().click();
    await page.getByLabel("Revocation reason").fill("dashboard revoke");
    await page.getByRole("button", { name: "Confirm" }).first().click();
    await expect
      .poll(async () => {
        const rows = (await managementQuery(
          `select status from public.capability_tokens where id = '${issued.capability.id}';`,
        )) as Array<{ status: string }>;
        return rows[0]?.status;
      })
      .toBe("revoked");
    const use = await consume(request, issued.capability.token, "admin-1", { issue_number: "1" }, SIM);
    expect((await use.json()).error.code).toBe("CAPABILITY_REVOKED");
  });
});
