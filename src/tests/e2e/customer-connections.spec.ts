import { createHash, randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { managementQuery } from "../integration/support";

/**
 * Embedded customer connections through the real running server and a real
 * browser: the dashboard setup UI (create an application, issue a backend
 * credential, configure its return URLs), the embedded Gmail connect flow
 * for two independent customers (Alex and Bob, each landing back on the
 * application's own return URL with no Authority credential at any point),
 * the resulting connection isolation between them, explicit task binding,
 * and backend-credential revocation. Runs against Gmail's in-process
 * fixture server (GMAIL_FIXTURE_MODE=1, set only for this Playwright-managed
 * test server -- see playwright.config.ts) standing in for Google, so this
 * is repeatable and touches no real account.
 */

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";

function suffix(): string {
  return randomBytes(4).toString("hex");
}

interface AppFixture {
  applicationId: string;
  backendSecret: string;
}

async function createApplicationFixture(name: string, returnUrls: string[]): Promise<AppFixture> {
  const id = suffix();
  const applicationId = `eeee0000-0000-4000-8000-${id}0000`.slice(0, 36);
  const plaintext = `authority_dk_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const keyPrefix = plaintext.slice(0, 21);
  const urlsLiteral = `ARRAY[${returnUrls.map((u) => `'${u}'`).join(", ")}]::text[]`;

  await managementQuery(`
    insert into public.applications (id, tenant_id, name, slug, allowed_return_urls)
    values ('${applicationId}', '${TENANT_A_ID}', '${name}', 'e2e-${id}', ${urlsLiteral});

    insert into public.developer_backend_credentials (tenant_id, application_id, key_prefix, key_hash)
    values ('${TENANT_A_ID}', '${applicationId}', '${keyPrefix}', '${hash}');
  `);

  return { applicationId, backendSecret: plaintext };
}

async function cleanupApplication(applicationId: string): Promise<void> {
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.connector_reservations where connection_id in (
      select id from public.connector_connections where owner_customer_id in (
        select id from public.customers where application_id = '${applicationId}'
      )
    );
    delete from public.task_connector_bindings where connection_id in (
      select id from public.connector_connections where owner_customer_id in (
        select id from public.customers where application_id = '${applicationId}'
      )
    );
    delete from public.tasks where customer_id in (select id from public.customers where application_id = '${applicationId}');
    delete from public.connector_connection_secrets where connection_id in (
      select id from public.connector_connections where owner_customer_id in (
        select id from public.customers where application_id = '${applicationId}'
      )
    );
    -- Must come before deleting connector_connections: a completed session
    -- stamps created_connection_id, which FKs straight at that table
    -- (connection_sessions_created_connection_id_tenant_id_fkey).
    delete from public.connection_sessions where application_id = '${applicationId}';
    delete from public.connector_connections where owner_customer_id in (
      select id from public.customers where application_id = '${applicationId}'
    );
    delete from public.customers where application_id = '${applicationId}';
    delete from public.developer_backend_credentials where application_id = '${applicationId}';
    delete from public.applications where id = '${applicationId}';
  `);
}

function backendApi(request: APIRequestContext, backendSecret: string) {
  const headers = { authorization: `Bearer ${backendSecret}` };
  return {
    createCustomer: (externalId: string) =>
      request.post("/api/v1/customers", { headers, data: { externalId } }),
    listConnections: (customerId: string) =>
      request.get(`/api/v1/customers/${customerId}/connections`, { headers }),
    openSession: (customerId: string, connectorId: string, returnUrl: string) =>
      request.post("/api/v1/connections/sessions", { headers, data: { customerId, connectorId, returnUrl } }),
    sessionStatus: (sessionId: string) =>
      request.get(`/api/v1/connections/sessions/${sessionId}`, { headers }),
    createTask: (customerId: string, body: Record<string, unknown>) =>
      request.post(`/api/v1/customers/${customerId}/tasks`, { headers, data: body }),
  };
}

/** Drives a real browser through the embedded connect flow and returns once it lands back on the return URL. */
async function connectGmailViaBrowser(
  page: Page,
  connectUrl: string,
  returnUrlPrefix: string,
): Promise<void> {
  await page.goto(connectUrl);
  await page.waitForURL((url) => url.toString().startsWith(returnUrlPrefix), { timeout: 15_000 });
}

test.describe("embedded customer connections", () => {
  test("an admin creates an application, issues a backend credential, and sets its return URLs through the dashboard", async ({
    page,
  }) => {
    const id = suffix();
    await page.goto("/app/settings/applications");
    await page.getByTestId("application-name").fill(`E2E App ${id}`);
    await page.getByTestId("application-slug").fill(`e2e-app-${id}`);
    await page.getByTestId("application-create").click();

    await page.waitForURL(/\/app\/settings\/applications\/[0-9a-f-]+$/);
    const applicationId = page.url().split("/").pop()!;

    await page.getByTestId("backend-credential-name").fill("CI key");
    await page.getByTestId("backend-credential-issue").click();
    const secret = await page.getByTestId("backend-credential-secret").innerText();
    expect(secret).toMatch(/^authority_dk_[0-9a-f]{64}$/);
    await page.getByTestId("backend-credential-secret-done").click();

    await page.getByTestId("application-return-urls").fill("https://app.example.com/integrations");
    await page.getByTestId("application-return-urls-save").click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await cleanupApplication(applicationId);
  });

  test("Alex and Bob each connect their own Gmail account; each sees only their own connection", async ({
    page,
    request,
  }) => {
    const returnUrl = "http://127.0.0.1:3100/app";
    const app = await createApplicationFixture(`E2E Isolation ${suffix()}`, [returnUrl]);
    const api = backendApi(request, app.backendSecret);

    const alexExternalId = `alex-${suffix()}`;
    const bobExternalId = `bob-${suffix()}`;
    try {
      const alex = await (await api.createCustomer(alexExternalId)).json();
      const bob = await (await api.createCustomer(bobExternalId)).json();
      expect(alex.customerId).toBeTruthy();
      expect(bob.customerId).not.toBe(alex.customerId);

      const alexSession = await (await api.openSession(alex.customerId, "gmail", returnUrl)).json();
      await connectGmailViaBrowser(page, alexSession.url, returnUrl);
      const alexStatus = await (await api.sessionStatus(alexSession.sessionId)).json();
      expect(alexStatus.status).toBe("completed");
      expect(alexStatus.connectionId).toBeTruthy();

      const bobSession = await (await api.openSession(bob.customerId, "gmail", returnUrl)).json();
      await connectGmailViaBrowser(page, bobSession.url, returnUrl);
      const bobStatus = await (await api.sessionStatus(bobSession.sessionId)).json();
      expect(bobStatus.status).toBe("completed");
      expect(bobStatus.connectionId).toBeTruthy();
      expect(bobStatus.connectionId).not.toBe(alexStatus.connectionId);

      const alexConnections = await (await api.listConnections(alex.customerId)).json();
      const bobConnections = await (await api.listConnections(bob.customerId)).json();
      expect(alexConnections.connections.map((c: { connectionId: string }) => c.connectionId)).toEqual([
        alexStatus.connectionId,
      ]);
      expect(bobConnections.connections.map((c: { connectionId: string }) => c.connectionId)).toEqual([
        bobStatus.connectionId,
      ]);

      // The dashboard's own Customers panel shows both, each with exactly one
      // connection of their own -- never a shared or duplicated entry.
      await page.goto(`/app/settings/applications/${app.applicationId}`);
      const alexRow = page.getByTestId(`customer-${alexExternalId}`);
      const bobRow = page.getByTestId(`customer-${bobExternalId}`);
      await expect(alexRow).toBeVisible();
      await expect(bobRow).toBeVisible();
      await expect(alexRow.getByText("gmail", { exact: false })).toHaveCount(1);
      await expect(bobRow.getByText("gmail", { exact: false })).toHaveCount(1);
    } finally {
      await cleanupApplication(app.applicationId);
    }
  });

  test("a task bound to a customer's own connection succeeds; naming another customer's connection is denied before any task is created", async ({
    request,
    page,
  }) => {
    const returnUrl = "http://127.0.0.1:3100/app";
    const app = await createApplicationFixture(`E2E Binding ${suffix()}`, [returnUrl]);
    const api = backendApi(request, app.backendSecret);

    const agents = (await managementQuery(
      `select id from public.agents where tenant_id = '${TENANT_A_ID}' limit 1;`,
    )) as Array<{ id: string }>;
    const agentId = agents[0]?.id;
    expect(agentId, "expected at least one existing agent in tenant A's demo data").toBeTruthy();

    try {
      const alex = await (await api.createCustomer(`alex-${suffix()}`)).json();
      const bob = await (await api.createCustomer(`bob-${suffix()}`)).json();

      const alexSession = await (await api.openSession(alex.customerId, "gmail", returnUrl)).json();
      await connectGmailViaBrowser(page, alexSession.url, returnUrl);
      const alexStatus = await (await api.sessionStatus(alexSession.sessionId)).json();

      const bobSession = await (await api.openSession(bob.customerId, "gmail", returnUrl)).json();
      await connectGmailViaBrowser(page, bobSession.url, returnUrl);
      const bobStatus = await (await api.sessionStatus(bobSession.sessionId)).json();

      const allowed = await api.createTask(alex.customerId, {
        agentId,
        intent: "e2e: read Alex's own inbox",
        connections: [{ connectorId: "gmail", connectionId: alexStatus.connectionId }],
      });
      expect(allowed.status()).toBe(201);
      const allowedBody = await allowed.json();
      expect(allowedBody.taskId).toBeTruthy();

      const denied = await api.createTask(alex.customerId, {
        agentId,
        intent: "e2e: try to read Bob's inbox from Alex's task",
        connections: [{ connectorId: "gmail", connectionId: bobStatus.connectionId }],
      });
      expect(denied.status()).toBe(403);
      const deniedBody = await denied.json();
      expect(deniedBody.error.code).toBe("CONNECTION_NOT_USABLE_BY_CUSTOMER");
    } finally {
      await cleanupApplication(app.applicationId);
    }
  });

  test("revoking a backend credential immediately stops it from creating new customers", async ({
    page,
    request,
  }) => {
    const app = await createApplicationFixture(`E2E Revoke ${suffix()}`, ["http://127.0.0.1:3100/app"]);
    const api = backendApi(request, app.backendSecret);

    try {
      const before = await api.createCustomer(`pre-revoke-${suffix()}`);
      expect(before.status()).toBeLessThan(300);

      await page.goto(`/app/settings/applications/${app.applicationId}`);
      // Scoped to the <li> specifically -- the create-credential form's own
      // input/button (backend-credential-name, backend-credential-issue)
      // also match a bare `[data-testid^="backend-credential-"]` prefix and
      // appear earlier in the DOM, so `.first()` without the tag constraint
      // silently grabbed one of those instead of the credential row.
      const row = page.locator('li[data-testid^="backend-credential-"]').first();
      await row.getByRole("button", { name: "Revoke" }).click();
      await page.locator('input[placeholder="Revocation reason"]').fill("e2e test revocation");
      await page.getByRole("button", { name: "Confirm revoke" }).click();
      await expect(page.getByText("Revoked", { exact: true })).toBeVisible();

      const after = await api.createCustomer(`post-revoke-${suffix()}`);
      expect(after.status()).toBe(401);
    } finally {
      await cleanupApplication(app.applicationId);
    }
  });

  test("the Get started page renders all four steps with honest readiness for a freshly created application", async ({
    page,
  }) => {
    const app = await createApplicationFixture(`E2E Get Started ${suffix()}`, []);
    try {
      await page.goto(`/app/settings/applications/${app.applicationId}/get-started`);
      await expect(page.getByRole("heading", { name: /Get started/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Application" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Access and approvals" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Run your agent" })).toBeVisible();
      // No backend credential was ever issued for this fresh application.
      await expect(page.getByText("Missing credentials").first()).toBeVisible();
      await expect(page.getByTestId("get-started-snippet")).toContainText("AuthorityBackendClient");
    } finally {
      await cleanupApplication(app.applicationId);
    }
  });
});
