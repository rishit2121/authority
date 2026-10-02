"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { DOCS_NAV, type DocsNavItem } from "./docs-nav-data";

function NavLink({ item, pathname }: { item: DocsNavItem; pathname: string }) {
  const active = pathname === item.href;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
        active ? "bg-ink text-paper" : "text-ink-soft hover:bg-black/[0.04] hover:text-ink"
      }`}
    >
      {item.label}
    </Link>
  );
}

export function DocsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="flex flex-col gap-0.5">
      <Link
        href="/docs"
        className="mb-2 block px-2.5 py-1 font-label-caps text-[11px] uppercase tracking-wider text-outline"
      >
        Documentation
      </Link>
      {DOCS_NAV.map((item) => (
        <div key={item.href}>
          <NavLink item={item} pathname={pathname} />
          {item.children ? (
            <div className="ml-3 flex flex-col gap-0.5 border-l border-line pl-2">
              {item.children.map((child) => (
                <NavLink key={child.href} item={child} pathname={pathname} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
