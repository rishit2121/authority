import { FOOTER_COLUMNS, LEGAL_LINKS } from "@/lib/navigation";

import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="relative w-full border-t border-outline-variant/30 bg-surface-container-low">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

      <div className="mx-auto max-w-7xl px-gutter-lg pb-space-xl pt-space-2xl">
        <div className="grid grid-cols-1 gap-space-2xl border-b border-outline-variant/20 pb-space-2xl md:grid-cols-4">
          <div className="flex flex-col gap-space-md md:col-span-1">
            <div className="flex items-center gap-space-sm">
              <Logo size={24} />
              <span className="font-headline-sm text-headline-sm font-semibold tracking-tight text-on-surface">
                Authority
              </span>
            </div>
            <p className="pr-space-md font-body-sm text-body-sm text-on-surface-variant">
              Deterministic runtime authorization, ephemeral delegation, and cryptographic least-privilege for
              autonomous AI agents.
            </p>
            <div className="inline-flex w-fit items-center gap-space-xs rounded-full border border-outline-variant/40 bg-surface-container-lowest px-space-md py-space-xs">
              <span className="h-2 w-2 rounded-full bg-allow shadow-[0_0_8px_#42E7A5]" />
              <span className="font-mono-token text-mono-token uppercase tracking-wider text-on-surface">
                All systems operational
              </span>
            </div>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-space-md">
              <span className="font-label-caps text-label-caps uppercase tracking-wider text-outline">
                {column.title}
              </span>
              <ul className="flex flex-col gap-space-sm">
                {column.links.map((link) => (
                  <li key={link.label} className="font-body-sm text-body-sm">
                    <a
                      href={link.href}
                      className="text-on-surface-variant transition-colors hover:text-on-surface"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-space-md pt-space-lg sm:flex-row">
          <p className="font-body-sm text-body-sm text-outline">
            © 2025 Authority Substrate Inc. All rights reserved. Zero-trust runtime protection for agentic
            models.
          </p>
          <div className="flex items-center gap-space-lg">
            {LEGAL_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="font-body-sm text-body-sm text-outline transition-colors hover:text-on-surface"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
