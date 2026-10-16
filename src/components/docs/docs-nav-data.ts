export interface DocsNavItem {
  label: string;
  href: string;
  children?: DocsNavItem[];
}

export interface DocsNavGroup {
  title: string;
  items: DocsNavItem[];
}

export const DOCS_NAV_GROUPS: DocsNavGroup[] = [
  {
    title: "Getting started",
    items: [
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "HTTP walkthrough", href: "/docs/http-walkthrough" },
    ],
  },
  {
    title: "Connect services and user access",
    items: [
      { label: "Customer connections", href: "/docs/customer-connections" },
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
          { label: "Linear", href: "/docs/connectors/linear" },
          { label: "Notion", href: "/docs/connectors/notion" },
        ],
      },
    ],
  },
  {
    title: "Authentication and task sessions",
    items: [
      { label: "Authentication", href: "/docs/authentication" },
      { label: "Task sessions", href: "/docs/task-sessions" },
    ],
  },
  {
    title: "Tasks, contracts and approvals",
    items: [
      { label: "Task lifecycle", href: "/docs/task-lifecycle" },
      { label: "Tool filtering", href: "/docs/tool-filtering" },
      { label: "Authorize and execute", href: "/docs/authorize-and-execute" },
      { label: "Approvals and replanning", href: "/docs/approvals-and-replanning" },
    ],
  },
  {
    title: "Task alignment",
    items: [{ label: "Task alignment and value checks", href: "/docs/task-alignment" }],
  },
  {
    title: "Optional content screening",
    items: [{ label: "External-content screening", href: "/docs/content-screening" }],
  },
  {
    title: "Results, troubleshooting and evaluation",
    items: [
      { label: "Results and evaluation", href: "/docs/results-and-evaluation" },
      { label: "Errors and troubleshooting", href: "/docs/errors" },
      { label: "API reference", href: "/docs/api-reference" },
    ],
  },
];

/** Flat list (every top-level item), in navigation order. */
export const DOCS_NAV: DocsNavItem[] = DOCS_NAV_GROUPS.flatMap((g) => g.items);
