import Link from "next/link";
import type { ReactNode } from "react";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-[9px] border border-ink bg-ink px-6 py-3 text-[15px] font-medium text-paper-raised transition-all duration-150 hover:bg-[#262923] hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/**
 * The near-black primary button from the hero/header correction — not the indigo
 * `PrimaryButton`, which the rest of the marketing page still uses until this
 * palette propagates past the first fold.
 */
export function InkButton({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`${BASE} ${className}`}>
      {children}
    </Link>
  );
}
