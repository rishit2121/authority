import { expect, test } from "@playwright/test";

import { managementQuery } from "../integration/support";
import { signIn } from "./support/auth";
import { ADMIN_A } from "./support/users";

/**
 * The Custom API connector setup wizard, driven through the real browser UI:
 * create a connection, set a credential, draft an operation, validate it, and
 * publish it -- the one privileged, trust-conferring step a developer alone
 * cannot take. No real third-party API is involved; this proves the wizard
 * and the draft -> validated -> published lifecycle, not live execution
 * (that is covered by src/tests/integration/connectors/custom-api-connector.test.ts
 * against a real database with an in-memory fixture provider).
 */

const RUN = Date.now().toString(36);

test.describe("Custom API connector setup wizard", () => {
  let connectionName: string;

  test.afterEach(async () => {
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.custom_operation_definitions where connection_id in
        (select id from public.connector_connections where name = '${connectionName}');
      delete from public.connector_connection_secrets where connection_id in
        (select id from public.connector_connections where name = '${connectionName}');
      delete from public.connector_connections where name = '${connectionName}';
    `);
  });

  test("connect, configure a credential, and publish an operation", async ({ page }) => {
    connectionName = `Widget Orders E2E ${RUN}`;
    await signIn(page, ADMIN_A, { next: "/app/integrations/custom-api" });

    await page.getByTestId("custom-api-name").fill(connectionName);
    await page.getByTestId("custom-api-base-url").fill("https://api.widget-orders.example.com");
    await page.getByTestId("custom-api-connect").click();

    const card = page.locator('[data-testid^="custom-api-connection-custom_"]', { hasText: connectionName });
    await expect(card).toBeVisible();

    await card.getByTestId("custom-api-secret-value").fill("e2e-fixture-bearer-token");
    await card.getByTestId("custom-api-save-secret").click();
    await expect(card.getByText("Credential saved.")).toBeVisible();

    await card.locator('input[placeholder="get_order"]').fill("get_order");
    await card.locator('input[placeholder="Get order"]').fill("Get order");
    await card.getByTestId("custom-api-create-operation").click();
    await expect(card.getByTestId("custom-api-op-get_order")).toBeVisible();
    await expect(card.getByTestId("custom-api-op-get_order")).toContainText("draft");

    await card.getByTestId("custom-api-op-get_order").getByRole("button", { name: "Validate" }).click();
    await expect(card.getByTestId("custom-api-op-get_order")).toContainText("validated");

    await card.getByTestId("custom-api-publish-get_order").click();
    await expect(card.getByTestId("custom-api-op-get_order")).toContainText("published");

    await page.screenshot({ path: "test-results/custom-api-connector-published.png", fullPage: true });
  });
});
