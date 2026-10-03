export interface DocsNavItem {
  label: string;
  href: string;
  children?: DocsNavItem[];
}

export const DOCS_NAV: DocsNavItem[] = [
  { label: "Quickstart", href: "/docs/quickstart" },
  { label: "Authentication", href: "/docs/authentication" },
  { label: "Task sessions", href: "/docs/task-sessions" },
  { label: "Tool filtering", href: "/docs/tool-filtering" },
  { label: "Authorize and execute", href: "/docs/authorize-and-execute" },
  { label: "Approvals and replanning", href: "/docs/approvals-and-replanning" },
  { label: "Customer connections", href: "/docs/customer-connections" },
  { label: "Task lifecycle (developer API)", href: "/docs/task-lifecycle" },
  {
    label: "Connector guides",
    href: "/docs/connectors",
    children: [
      { label: "GitHub", href: "/docs/connectors/github" },
      { label: "Custom API", href: "/docs/connectors/custom-api" },
      { label: "Stripe", href: "/docs/connectors/stripe" },
      { label: "Slack", href: "/docs/connectors/slack" },
      { label: "Gmail", href: "/docs/connectors/gmail" },
      { label: "PostgreSQL", href: "/docs/connectors/postgres" },
    ],
  },
  { label: "API reference", href: "/docs/api-reference" },
  { label: "Errors and troubleshooting", href: "/docs/errors" },
];
