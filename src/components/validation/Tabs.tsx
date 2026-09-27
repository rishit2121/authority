"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/validation", label: "Environments", exact: true },
  { href: "/app/validation/scenarios", label: "Scenario library" },
  { href: "/app/validation/campaigns/new", label: "Campaign builder" },
  { href: "/app/validation/campaigns", label: "Runs", exact: true },
  { href: "/app/validation/findings", label: "Findings" },
  { href: "/app/validation/remediations", label: "Remediations" },
  { href: "/app/validation/regressions", label: "Regression history" },
];

export function ValidationTabs() {
  const path = usePathname();
  const active = (t: (typeof TABS)[number]) =>
    t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
  return (
    <nav
      aria-label="Validation Lab"
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-outline-variant/30 pb-2"
    >
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active(t) ? "page" : undefined}
          className={`shrink-0 rounded-md px-3 py-1.5 font-body-sm text-body-sm transition-colors ${
            active(t)
              ? "bg-primary/10 text-primary"
              : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
