import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { PRIMARY_NAV } from "@/lib/navigation";

import { Logo } from "./Logo";

export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-outline-variant/30 bg-surface-container-lowest/90 shadow-[0_1px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] w-full max-w-7xl items-center justify-between gap-space-sm px-gutter sm:px-gutter-lg">
        <div className="flex min-w-0 items-center gap-space-lg">
          <a href="#top" className="group flex min-w-0 items-center gap-space-md">
            <Logo />
            <span className="flex min-w-0 flex-col">
              <span className="font-headline-sm text-headline-sm font-semibold tracking-tight text-on-surface transition-colors group-hover:text-primary">
                Authority
              </span>
              <span className="font-label-caps text-label-caps uppercase tracking-widest text-outline">
                Runtime Substrate
              </span>
            </span>
          </a>

          <div className="ml-space-xs hidden h-5 w-px bg-outline-variant/40 lg:block" />

          <nav aria-label="Primary" className="hidden items-center gap-space-xl md:flex">
            {PRIMARY_NAV.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="font-body-md text-body-md text-on-surface-variant transition-colors hover:text-on-surface"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-space-md">
          <Link
            href="/login"
            className="hidden px-space-md py-space-sm font-body-md text-body-md text-on-surface-variant transition-colors hover:text-on-surface sm:inline-block"
          >
            Sign in
          </Link>
          <a
            href="#request-access"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-space-lg font-headline-sm text-body-md font-medium text-on-primary shadow-[0_0_20px_-4px_rgba(85,216,255,0.35)] transition-all hover:bg-primary-fixed hover:shadow-[0_0_24px_-2px_rgba(85,216,255,0.5)]"
          >
            Request access
          </a>
          <span className="ml-space-xs hidden h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary sm:flex">
            <Icon name="person" size={18} />
          </span>
        </div>
      </div>
    </header>
  );
}
