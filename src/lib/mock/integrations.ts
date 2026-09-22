/**
 * Connected tool providers, for the Integrations page and its sidebar badge.
 *
 * Not part of the Zod authorization domain — `Integration` was never in the
 * Part 1 entity list — so this is a plain typed fixture, kept in `lib/mock`
 * alongside the rest of the demo data rather than in `lib/domain`.
 */
export type IntegrationStatus = "connected" | "warning" | "not_connected";

export interface IntegrationSummary {
  id: string;
  name: string;
  status: IntegrationStatus;
  detail: string;
}

export const demoIntegrations: IntegrationSummary[] = [
  { id: "github", name: "GitHub", status: "connected", detail: "org/payments-api and 3 other repositories" },
  { id: "stripe", name: "Stripe", status: "connected", detail: "Restricted key, refunds and reads only" },
  { id: "gmail", name: "Gmail", status: "connected", detail: "Send-only scope for customer-ops-agent" },
  {
    id: "postgres",
    name: "PostgreSQL",
    status: "warning",
    detail: "Read replica credential rotates in 4 days",
  },
  { id: "slack", name: "Slack", status: "not_connected", detail: "No workspace connected" },
  { id: "salesforce", name: "Salesforce", status: "not_connected", detail: "No org connected" },
];

export function countIntegrationWarnings(integrations: IntegrationSummary[] = demoIntegrations): number {
  return integrations.filter((integration) => integration.status === "warning").length;
}
