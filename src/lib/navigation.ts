export interface NavLink {
  label: string;
  href: string;
}

export const PRIMARY_NAV: NavLink[] = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Security", href: "#security" },
  { label: "Docs", href: "/docs" },
];

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "One task, exact authority", href: "#product" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Tool call trace", href: "#trace" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Live walkthrough", href: "/demo" },
      { label: "Documentation", href: "/docs" },
    ],
  },
  {
    title: "Company",
    links: [{ label: "Security model", href: "#security" }],
  },
];

export const LEGAL_LINKS: NavLink[] = [
  { label: "Privacy Policy", href: "#" },
  { label: "Terms of Service", href: "#" },
  { label: "Disclosures", href: "#" },
];
