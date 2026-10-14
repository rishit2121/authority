export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  /** null = not yet built in this deployment; renders "Coming soon" with no link. */
  href: string | null;
  logo: { src: string; alt: string };
}

/**
 * Every connector the dashboard offers, shared by the Connections page and
 * the Setup page. Ordered roughly by how often a first-time user reaches for
 * each one.
 */
export const CONNECTOR_CATALOG: CatalogEntry[] = [
  {
    id: "slack",
    name: "Slack",
    description: "Post messages and list channels in a connected workspace.",
    href: "/app/integrations/slack",
    logo: { src: "/logos/slack.svg", alt: "" },
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, search, and send email from a connected Google account.",
    href: "/app/integrations/gmail",
    logo: { src: "/logos/gmail.svg", alt: "" },
  },
  {
    id: "github",
    name: "GitHub",
    description: "Install the GitHub App, allow repositories, and bind tasks to them.",
    href: "/app/integrations/github",
    logo: { src: "/logos/github.svg", alt: "" },
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read pages and databases, and create new pages.",
    href: "/app/integrations/notion",
    logo: { src: "/logos/notion.svg", alt: "" },
  },
  {
    id: "linear",
    name: "Linear",
    description: "List and create issues on a team, and look up one by id.",
    href: "/app/integrations/linear",
    logo: { src: "/logos/linear.svg", alt: "" },
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Retrieve payments and customers, list charges, and issue refunds.",
    href: "/app/integrations/stripe",
    logo: { src: "/logos/stripe.svg", alt: "" },
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    description: "Run named, parameterized queries against your own database.",
    href: "/app/integrations/postgres",
    logo: { src: "/logos/postgresql.svg", alt: "" },
  },
  {
    id: "custom-api",
    name: "Custom API",
    description: "Connect any HTTPS API your tenant controls and publish schema-constrained operations.",
    href: "/app/integrations/custom-api",
    logo: { src: "/logos/custom-api.svg", alt: "" },
  },
];

const LABEL_BY_CONNECTOR_ID: Record<string, string> = {
  slack: "Slack",
  gmail: "Gmail",
  github: "GitHub",
  notion: "Notion",
  linear: "Linear",
  stripe: "Stripe",
};

/** Human label for a `connector_connections.connector_id` (Custom API and PostgreSQL ids are per-connection). */
export function connectorLabel(connectorId: string): string {
  if (connectorId.startsWith("custom_")) return "Custom API";
  if (connectorId.startsWith("postgres_")) return "PostgreSQL";
  return LABEL_BY_CONNECTOR_ID[connectorId] ?? connectorId;
}
