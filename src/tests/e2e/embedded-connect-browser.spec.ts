import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

// examples/customer-app is plain, dependency-free Node ESM (not part of the
// TS build) -- the same cross-boundary relationship
// src/tests/integration/connectors/mock-broker-server.ts has with its own
// examples/customer-app/mock-broker-server.mjs twin, except here the
// browser-facing demo server has no reason to exist in two copies: it's
// already the real runnable example, and this test drives it exactly as a
// real customer's browser would.
// @ts-expect-error -- plain JS example module, not part of the TS project (see tsconfig's include).
import { startBrowserDemoServer } from "../../../examples/customer-app/browser-demo-server.mjs";

import { managementQuery } from "../integration/support";

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Exercises the real embedded-connection browser routes end to end, starting
 * from the example customer app itself -- not a setup helper that creates a
 * connection directly, and not a plain-fetch stand-in
 * (simulate-browser-connect.mjs). A real Playwright browser:
 *   1. loads the example app's own page (examples/customer-app/browser-demo-server.mjs),
 *   2. clicks "Connect Gmail", which redirects it to Authority's real
 *      `GET /connect/{token}` (src/app/connect/[token]/route.ts),
 *   3. which redirects to Gmail's OAuth endpoint -- answered by the real
 *      in-process Gmail fixture (GMAIL_FIXTURE_MODE=1, see
 *      src/lib/connectors/gmail/fixture-server.ts), not a mock of this
 *      flow -- which redirects to Authority's real embedded callback
 *      (`GET /api/connectors/gmail/embedded-callback`, confirmed to be a
 *      distinct route from the dashboard's own `/api/connectors/gmail/callback`),
 *   4. which redirects the browser back to the example app's own `/connected`
 *      page, exactly as a real customer would land back on Acme's site.
 */
test.describe("embedded connect, driven by a real browser through the example customer app", () => {
  test("Alex connects Gmail starting from the example app, with no Authority login at any point", async ({
    page,
    context,
  }) => {
    // No Authority session cookie at all -- Alex never signs in to Authority.
    await context.clearCookies();

    const suffix = randomBytes(4).toString("hex");
    const applicationId = `ffff0000-0000-4000-8000-${suffix}0000`;
    const plaintext = `authority_dk_${randomBytes(32).toString("hex")}`;
    const hash = createHash("sha256").update(plaintext).digest("hex");
    const keyPrefix = plaintext.slice(0, 21);

    const demo = await startBrowserDemoServer({
      authorityBaseUrl: "http://127.0.0.1:3100",
      backendKey: plaintext,
      externalId: `alex-${suffix}`,
    });

    await managementQuery(`
      insert into public.applications (id, tenant_id, name, slug, allowed_return_urls, require_task_sessions) values ('${applicationId}', '${TENANT_A_ID}', 'Embedded browser test app', 'embedded-browser-${suffix}', ARRAY['${demo.returnUrl}']::text[], false);
      insert into public.developer_backend_credentials (tenant_id, application_id, key_prefix, key_hash)
      values ('${TENANT_A_ID}', '${applicationId}', '${keyPrefix}', '${hash}');
    `);

    try {
      // 1. The browser starts on the example customer app itself.
      await page.goto(demo.url);
      await expect(page.getByRole("heading", { name: "Acme account settings" })).toBeVisible();

      // 2.-4. One click drives the browser through every real hop above,
      // landing back on the example app's own page -- never an Authority
      // dashboard URL, never prompting for an Authority credential.
      await page.getByRole("link", { name: "Connect Gmail" }).click();
      await page.waitForURL(
        (url) => url.origin === new URL(demo.url).origin && url.pathname === "/connected",
        {
          timeout: 15_000,
        },
      );

      await expect(page.getByRole("heading", { name: "Gmail connected" })).toBeVisible();
      const connectionId = await page.getByTestId("connection-id").textContent();
      expect(connectionId).toMatch(/^[0-9a-f-]{36}$/);

      // The connection this flow created really is owned by this specific
      // customer, not the organization -- the property every other
      // customer-isolation assertion in customer-connections.spec.ts also
      // depends on, confirmed here for the literal browser path too.
      const [row] = (await managementQuery(
        `select owner_kind, verified_account_ref from public.connector_connections where id = '${connectionId}';`,
      )) as Array<{ owner_kind: string; verified_account_ref: string }>;
      expect(row.owner_kind).toBe("customer");
      expect(row.verified_account_ref).toBeTruthy();
    } finally {
      await demo.stop();
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.connector_execution_receipts where connection_id in (
          select id from public.connector_connections where owner_customer_id in (select id from public.customers where application_id = '${applicationId}')
        );
        delete from public.connector_reservations where connection_id in (
          select id from public.connector_connections where owner_customer_id in (select id from public.customers where application_id = '${applicationId}')
        );
        delete from public.task_connector_bindings where connection_id in (
          select id from public.connector_connections where owner_customer_id in (select id from public.customers where application_id = '${applicationId}')
        );
        delete from public.connection_sessions where application_id = '${applicationId}';
        delete from public.connector_connection_secrets where connection_id in (
          select id from public.connector_connections where owner_customer_id in (select id from public.customers where application_id = '${applicationId}')
        );
        delete from public.connector_connections where owner_customer_id in (select id from public.customers where application_id = '${applicationId}');
        delete from public.customers where application_id = '${applicationId}';
        delete from public.developer_backend_credentials where application_id = '${applicationId}';
        delete from public.applications where id = '${applicationId}';
      `);
    }
  });
});
