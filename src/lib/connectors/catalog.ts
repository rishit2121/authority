import { REST_CONNECTOR_SPECS } from "./rest/providers";

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  /** Grouping on the Connections page. */
  category: string;
  /** null = not yet built in this deployment; renders "Coming soon" with no link. */
  href: string | null;
  logo: { src: string; alt: string };
}

/** The hand-written connectors, each with its own dashboard page and connector module. */
const HAND_WRITTEN: CatalogEntry[] = [
  {
    id: "slack",
    category: "Communication",
    name: "Slack",
    description: "Post messages and list channels in a connected workspace.",
    href: "/app/integrations/slack",
    logo: { src: "/logos/slack.svg", alt: "" },
  },
  {
    id: "gmail",
    category: "Communication",
    name: "Gmail",
    description: "Read, search, and send email from a connected Google account.",
    href: "/app/integrations/gmail",
    logo: { src: "/logos/gmail.svg", alt: "" },
  },
  {
    id: "github",
    category: "Developer tools",
    name: "GitHub",
    description: "Install the GitHub App, allow repositories, and bind tasks to them.",
    href: "/app/integrations/github",
    logo: { src: "/logos/github.svg", alt: "" },
  },
  {
    id: "notion",
    category: "Productivity",
    name: "Notion",
    description: "Read pages and databases, and create new pages.",
    href: "/app/integrations/notion",
    logo: { src: "/logos/notion.svg", alt: "" },
  },
  {
    id: "linear",
    category: "Project management",
    name: "Linear",
    description: "List and create issues on a team, and look up one by id.",
    href: "/app/integrations/linear",
    logo: { src: "/logos/linear.svg", alt: "" },
  },
  {
    id: "stripe",
    category: "Commerce & payments",
    name: "Stripe",
    description: "Retrieve payments and customers, list charges, and issue refunds.",
    href: "/app/integrations/stripe",
    logo: { src: "/logos/stripe.svg", alt: "" },
  },
  {
    id: "postgresql",
    category: "Data & storage",
    name: "PostgreSQL",
    description: "Run named, parameterized queries against your own database.",
    href: "/app/integrations/postgres",
    logo: { src: "/logos/postgresql.svg", alt: "" },
  },
  {
    id: "custom-api",
    category: "Developer tools",
    name: "Custom API",
    description: "Connect any HTTPS API your tenant controls and publish schema-constrained operations.",
    href: "/app/integrations/custom-api",
    logo: { src: "/logos/custom-api.svg", alt: "" },
  },
];

/**
 * Every connector the dashboard offers, shared by the Connections page and the Setup page: the hand-written ones
 * first (ordered roughly by how often a first-time user reaches for each), then every declarative REST connector.
 */
export const CONNECTOR_CATALOG: CatalogEntry[] = [
  ...HAND_WRITTEN,
  ...REST_CONNECTOR_SPECS.map((spec) => ({
    id: spec.id,
    category: spec.category,
    name: spec.name,
    description: spec.description,
    href: `/app/integrations/${spec.id}`,
    logo: { src: `/logos/${spec.id}.svg`, alt: "" },
  })),
];

/** The categories in display order, each listed once. */
export const CONNECTOR_CATEGORIES: string[] = [
  ...new Set(CONNECTOR_CATALOG.map((entry) => entry.category)),
].sort();

const LABEL_BY_CONNECTOR_ID: Record<string, string> = {
  ...Object.fromEntries(REST_CONNECTOR_SPECS.map((spec) => [spec.id, spec.name])),
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
