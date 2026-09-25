import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/marketing/Logo";

/**
 * Chrome for the authentication routes.
 *
 * Deliberately the product's own surface rather than a default Supabase form:
 * the same near-black navy field, hairline borders and cyan accent as the
 * control plane, so signing in reads as entering Authority.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
  aside,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Short security-oriented statement shown under the card. */
  aside?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-container-lowest px-gutter py-space-2xl">
      <div className="w-full max-w-[26rem]">
        <Link
          href="/"
          className="mb-space-xl flex items-center justify-center gap-space-sm"
          aria-label="Authority home"
        >
          <Logo size={26} />
          <span className="flex flex-col leading-tight">
            <span className="font-headline-sm text-body-lg font-semibold text-on-surface">Authority</span>
            <span className="font-label-caps text-[10px] uppercase tracking-widest text-outline">
              Runtime authorization
            </span>
          </span>
        </Link>

        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-space-xl shadow-2xl">
          <h1 className="font-headline-md text-headline-md text-on-surface">{title}</h1>
          <p className="mt-space-sm font-body-md text-body-md text-on-surface-variant">{description}</p>

          <div className="mt-space-xl">{children}</div>

          {footer ? (
            <div className="mt-space-xl border-t border-outline-variant/20 pt-space-lg font-body-md text-body-md text-on-surface-variant">
              {footer}
            </div>
          ) : null}
        </div>

        {aside ? (
          <p className="mt-space-lg text-center font-body-sm text-body-sm text-outline">{aside}</p>
        ) : null}
      </div>
    </main>
  );
}
