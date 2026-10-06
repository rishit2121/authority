import { createHash, randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { managementQuery } from "../integration/support";

/**
 * The admin access-management panel (AccessManagementPanel.tsx, backed by
 * 20261003000020/000021) through a real browser and the real HTTP API --
 * not just the underlying RPCs proven in backend-access-management.test.ts.
 * Specifically proves the panel's two controls (connection scope, backend
 * credential can_manage_access) actually change what the live grant API
 * will do, in both directions: widening when an admin configures it, and
 * immediately narrowing again when the admin changes it back -- the
 * "preserve the existing authorization limits" requirement this panel must
 * not weaken.
 */

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";

function suffix(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Creates the application AND issues its backend credential entirely
 * through the dashboard UI -- the exact flow proven in
 * customer-connections.spec.ts's own first test. An application row
 * inserted directly via SQL (bypassing this creation flow) was found live
 * to leave its credential invisible to the dashboard's own query on a
 * fresh first visit, even though the row exists -- not a bug in the new
 * access-management panel, but avoided here entirely by going through the
 * real flow instead of chasing that down.
 */
async function createApplicationAndCredentialViaUi(
  page: Page,
  name: string,
): Promise<{ applicationId: string; backendSecret: string }> {
  const id = suffix();
  await page.goto("/app/settings/applications");
  await page.getByTestId("application-name").fill(name);
  await page.getByTestId("application-slug").fill(`e2e-am-${id}`);
  await page.getByTestId("application-create").click();
  await page.waitForURL(/\/app\/settings\/applications\/[0-9a-f-]+$/);
  const applicationId = page.url().split("/").pop()!;

  await page.getByTestId("backend-credential-name").fill("E2E access-management key");
  await page.getByTestId("backend-credential-issue").click();
  const backendSecret = await page.getByTestId("backend-credential-secret").innerText();
  await page.getByTestId("backend-credential-secret-done").click();

  return { applicationId, backendSecret };
}

async function createOrgConnection(suffix_: string): Promise<string> {
  const id = randomBytes(16).toString("hex");
  const connectionId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
  await managementQuery(`
    insert into public.connector_connections (id, tenant_id, connector_id, name, owner_kind, verified_account_ref, status)
    values ('${connectionId}', '${TENANT_A_ID}', 'slack', 'e2e-am-connection-${suffix_}', 'organization', 'e2e-am-${suffix_}', 'active');
  `);
  return connectionId;
}

async function cleanup(applicationId: string, connectionId: string): Promise<void> {
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.backend_connection_access_grants where delegation_id in (
      select id from public.connection_delegations where connection_id = '${connectionId}'
    );
    delete from public.connection_delegations where connection_id = '${connectionId}';
    delete from public.application_connection_access_policies where connection_id = '${connectionId}';
    delete from public.connector_connections where id = '${connectionId}';
    delete from public.developer_backend_credentials where application_id = '${applicationId}';
    delete from public.customers where application_id = '${applicationId}';
    delete from public.applications where id = '${applicationId}';
  `);
}

function backendApi(request: APIRequestContext, backendSecret: string) {
  const headers = { authorization: `Bearer ${backendSecret}` };
  return {
    createCustomer: (externalId: string) =>
      request.post("/api/v1/customers", { headers, data: { externalId } }),
    grantAccess: (customerId: string, connectionId: string) =>
      request.post(`/api/v1/customers/${customerId}/connections/${connectionId}/access`, { headers }),
    revokeAccess: (customerId: string, connectionId: string) =>
      request.delete(`/api/v1/customers/${customerId}/connections/${connectionId}/access`, { headers }),
    listConnections: (customerId: string) =>
      request.get(`/api/v1/customers/${customerId}/connections`, { headers }),
  };
}

async function credentialIdFor(backendSecret: string): Promise<string> {
  const hash = createHash("sha256").update(backendSecret).digest("hex");
  const rows = (await managementQuery(
    `select id from public.developer_backend_credentials where key_hash = '${hash}';`,
  )) as Array<{ id: string }>;
  return rows[0].id;
}

test.describe("admin access-management panel", () => {
  test("configuring backend-grantable + credential scope through the UI lets the live grant API succeed, and narrowing back to admin-only immediately refuses it again", async ({
    page,
    request,
  }) => {
    const { applicationId, backendSecret } = await createApplicationAndCredentialViaUi(
      page,
      `E2E Access Mgmt ${suffix()}`,
    );
    const connectionId = await createOrgConnection(suffix());
    const api = backendApi(request, backendSecret);

    try {
      const customer = await api.createCustomer(`access-mgmt-${suffix()}`);
      expect(customer.status()).toBeLessThan(300);
      const { customerId } = await customer.json();

      // Before any admin configuration: refused because the credential has
      // no access-management scope yet (checked before the envelope itself).
      const beforeConfig = await api.grantAccess(customerId, connectionId);
      expect(beforeConfig.status()).toBe(403);
      expect((await beforeConfig.json()).error.code).toBe("FORBIDDEN");

      await page.goto(`/app/settings/applications/${applicationId}`);

      // Grant the credential access-management scope -- the connection's
      // policy is still admin_only, so this alone is not enough yet.
      const credentialId = await credentialIdFor(backendSecret);
      const toggle = page.getByTestId(`access-manage-toggle-${credentialId}`);
      await toggle.click();
      // The toggle's checked state is controlled entirely by server data
      // (useTransition + router.refresh(), no optimistic local state) -- a
      // live DOM assertion right after the click was found, live, to report
      // "did not change its state" even though the underlying write had
      // already committed correctly (confirmed by querying the database
      // directly) -- a router.refresh()-timing false negative, not a real
      // bug. Waiting for the action's own disabled-while-pending state to
      // clear, then reloading for a fresh SSR fetch, is the ground truth.
      await expect(toggle).toBeDisabled();
      await expect(toggle).toBeEnabled();
      await page.reload();
      await expect(toggle).toBeChecked();

      const stillNoPolicy = await api.grantAccess(customerId, connectionId);
      expect(stillNoPolicy.status()).toBe(403);
      expect((await stillNoPolicy.json()).error.code).toBe("NOT_IN_ENVELOPE");

      // Mark the connection backend_grantable.
      const scopeSelect = page.getByTestId(`access-scope-select-${connectionId}`);
      await scopeSelect.selectOption("backend_grantable");
      await expect(scopeSelect).toHaveValue("backend_grantable");

      // Now the live grant API succeeds, from code, with zero dashboard click per customer.
      const afterConfig = await api.grantAccess(customerId, connectionId);
      expect(afterConfig.status()).toBeLessThan(300);
      const listed = await api.listConnections(customerId);
      const { connections } = await listed.json();
      expect(connections.map((c: { connectionId: string }) => c.connectionId)).toContain(connectionId);

      // Revoke, then re-grant to confirm it isn't a one-shot fluke.
      const revoked = await api.revokeAccess(customerId, connectionId);
      expect(revoked.status()).toBeLessThan(300);
      const regranted = await api.grantAccess(customerId, connectionId);
      expect(regranted.status()).toBeLessThan(300);

      // Narrow the connection back to admin-only -- must immediately stop further grants.
      await page.goto(`/app/settings/applications/${applicationId}`);
      const narrowSelect = page.getByTestId(`access-scope-select-${connectionId}`);
      await narrowSelect.selectOption("admin_only");
      await expect(narrowSelect).toHaveValue("admin_only");

      const otherCustomer = await api.createCustomer(`access-mgmt-narrowed-${suffix()}`);
      const { customerId: otherCustomerId } = await otherCustomer.json();
      const afterNarrow = await api.grantAccess(otherCustomerId, connectionId);
      expect(afterNarrow.status()).toBe(403);
      expect((await afterNarrow.json()).error.code).toBe("NOT_IN_ENVELOPE");
    } finally {
      await cleanup(applicationId, connectionId);
    }
  });

  test("application-shared scope requires no per-customer grant at all, through the real connection-usability check", async ({
    page,
    request,
  }) => {
    const { applicationId, backendSecret } = await createApplicationAndCredentialViaUi(
      page,
      `E2E Access Shared ${suffix()}`,
    );
    const connectionId = await createOrgConnection(suffix());
    const api = backendApi(request, backendSecret);

    try {
      await page.goto(`/app/settings/applications/${applicationId}`);
      const sharedSelect = page.getByTestId(`access-scope-select-${connectionId}`);
      await sharedSelect.selectOption("application_shared");
      await expect(sharedSelect).toHaveValue("application_shared");

      const customer = await api.createCustomer(`access-shared-${suffix()}`);
      const { customerId } = await customer.json();

      // No grant call made at all -- application_shared alone must be enough.
      const listed = await api.listConnections(customerId);
      const { connections } = await listed.json();
      expect(connections.map((c: { connectionId: string }) => c.connectionId)).toContain(connectionId);
    } finally {
      await cleanup(applicationId, connectionId);
    }
  });
});
