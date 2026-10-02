import Link from "next/link";
import type { ReactNode } from "react";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-[9px] border border-line-strong bg-transparent px-6 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** The outlined secondary button paired with InkButton — see its doc comment. */
export function InkOutlineButton({
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
