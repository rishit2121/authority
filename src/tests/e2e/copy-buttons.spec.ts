import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { managementQuery, TENANT_A_ID } from "../integration/support";

/**
 * The two "Copy" buttons this session added: a Slack connection's own id
 * (Settings -> Integrations -> Slack, labeled "Connection ID" -- the
 * developer-facing SLACK_CONNECTION_ID value) and an agent's own id
 * (Configuration -> "Agent ID" on its detail page). Both copy a plain,
 * non-secret id -- never the Slack bot token, which this page's own module
 * comment confirms is never sent to the browser at all.
 */

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe("copy-to-clipboard buttons", () => {
  test("copies a Slack connection's id, labeled for SLACK_CONNECTION_ID, never the bot token", async ({
    page,
  }) => {
    const connectionId = randomUUID();
    await managementQuery(`
      insert into public.connector_connections (id, tenant_id, connector_id, name, owner_kind, status)
      values ('${connectionId}', '${TENANT_A_ID}', 'slack', 'copy-button-test-slack', 'organization', 'active');
    `);

    try {
      await page.goto("/app/integrations/slack");
      const card = page.getByTestId(`slack-connection-${connectionId}`);
      await expect(card).toBeVisible();
      await expect(card.getByText("Connection ID")).toBeVisible();
      await expect(card.getByText("Use this as SLACK_CONNECTION_ID in your application.")).toBeVisible();
      await expect(card.getByTestId(`slack-connection-id-${connectionId}-value`)).toHaveText(connectionId);

      // The bot token is never present as any value anywhere on this card.
      await expect(card.getByTestId("slack-bot-token-value")).toHaveValue("");

      await card.getByTestId(`slack-connection-id-${connectionId}-copy`).click();
      await expect(card.getByTestId(`slack-connection-id-${connectionId}-copy`)).toHaveText("Copied");
      expect(await clipboardText(page)).toBe(connectionId);
    } finally {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.connector_connections where id = '${connectionId}';
      `);
    }
  });

  test("copies an agent's own id, labeled for AUTHORITY_AGENT_ID", async ({ page }) => {
    const agentId = randomUUID();
    await managementQuery(`
      insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
      values ('${agentId}', '${TENANT_A_ID}', 'copy-button-test-agent', 'openai', 'gpt', 'x',
        (select id from public.principals where tenant_id = '${TENANT_A_ID}' and kind = 'human' and user_id is not null order by created_at limit 1),
        'active');
    `);

    try {
      await page.goto(`/app/agents/${agentId}`);
      await expect(page.getByText("Agent ID")).toBeVisible();
      await expect(page.getByTestId("agent-id-value")).toHaveText(agentId);

      await page.getByTestId("agent-id-copy").click();
      await expect(page.getByTestId("agent-id-copy")).toHaveText("Copied");
      expect(await clipboardText(page)).toBe(agentId);
    } finally {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.agents where id = '${agentId}';
      `);
    }
  });
});
