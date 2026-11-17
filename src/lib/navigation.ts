import { REPO_URL } from "@/lib/proof-run/commands";

export interface NavLink {
  label: string;
  href: string;
  /** Leaves the site: opened in a new tab with rel="noopener noreferrer". */
  external?: boolean;
}

/** Real routes only: the header renders on every marketing page, so in-page hash links would break off the home. */
export const PRIMARY_NAV: NavLink[] = [
  { label: "Docs", href: "/docs" },
  { label: "GitHub", href: REPO_URL, external: true },
  { label: "How it works", href: "/how-it-works" },
];

/** Signed-out header actions. Signed in, both are replaced by "Open console". */
export const SIGN_IN_LINK: NavLink = { label: "Sign in", href: "/login" };
export const SETUP_LINK: NavLink = { label: "Set up my agent", href: "/app/setup" };
export const CONSOLE_LINK: NavLink = { label: "Open console", href: "/app" };

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Try a protected call", href: "/#proof-run" },
      { label: "Example run", href: "/demo" },
      { label: "How it works", href: "/how-it-works" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "GitHub", href: REPO_URL, external: true },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Set up my agent", href: "/app/setup" },
      { label: "Sign in", href: "/login" },
    ],
  },
];

export const LEGAL_LINKS: NavLink[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

/** Props for an anchor that may leave the site. */
export function externalProps(link: NavLink): { target?: string; rel?: string } {
  return link.external ? { target: "_blank", rel: "noopener noreferrer" } : {};
}
