"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { safeReturnTo, SETUP_PATH } from "@/lib/setup/return-to";

/**
 * Shown on a connector page only when the user arrived from the Setup page: `?returnTo=<a validated /app/setup
 * path>` goes back to the exact step (app and connection kept), the older `?from=setup` to the Setup page itself.
 */
export function BackToSetup() {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const href = returnTo ?? (params.get("from") === "setup" ? SETUP_PATH : null);
  if (!href) return null;
  return (
    <Link
      href={href}
      className="mb-space-md inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
      data-testid="back-to-setup"
    >
      <Icon name="chevron_left" size={14} />
      Back to setup
    </Link>
  );
}
