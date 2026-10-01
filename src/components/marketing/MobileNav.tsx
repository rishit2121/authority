"use client";

import Link from "next/link";
import { useState } from "react";

import type { NavLink } from "@/lib/navigation";

export function MobileNav({
  links,
  signedIn,
  consoleHref,
}: {
  links: NavLink[];
  signedIn: boolean;
  consoleHref: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-md text-mkt-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-indigo"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          {open ? (
            <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          ) : (
            <path d="M3 6H17M3 10H17M3 14H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {open ? (
        <div
          id="mobile-nav-panel"
          className="absolute inset-x-0 top-[68px] flex flex-col gap-1 border-b border-mkt-hairline bg-mkt-surface px-6 py-4"
        >
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              className="py-2.5 text-[15px] text-mkt-text"
            >
              {link.label}
            </a>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t border-mkt-hairline pt-4">
            {signedIn ? (
              <Link href={consoleHref} className="py-2 text-[15px] font-medium text-mkt-indigo">
                Open console
              </Link>
            ) : (
              <>
                <Link href="/login" className="py-2 text-[15px] text-mkt-text">
                  Sign in
                </Link>
                <Link href="/signup" className="py-2 text-[15px] font-medium text-mkt-indigo">
                  Start building
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
