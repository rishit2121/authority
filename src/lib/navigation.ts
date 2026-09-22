export interface NavLink {
  label: string;
  href: string;
}

export const PRIMARY_NAV: NavLink[] = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Security", href: "#security" },
  { label: "Docs", href: "#docs" },
];

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Runtime Interceptor", href: "#product" },
      { label: "Graph Telemetry", href: "#product" },
      { label: "Policy Synthesizer", href: "#product" },
      { label: "Token Scopes Engine", href: "#product" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "#docs" },
      { label: "Go & Python SDKs", href: "#docs" },
      { label: "OIDC / SPIFFE Bridges", href: "#docs" },
      { label: "Architecture Blueprints", href: "#docs" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Security & Trust Center", href: "#security" },
      { label: "SOC2 Type II Attestation", href: "#how-it-works" },
      { label: "Research Papers", href: "#" },
      { label: "Contact Runtime Security", href: "#" },
    ],
  },
];

export const LEGAL_LINKS: NavLink[] = [
  { label: "Privacy Policy", href: "#" },
  { label: "Terms of Service", href: "#" },
  { label: "Disclosures", href: "#" },
];
