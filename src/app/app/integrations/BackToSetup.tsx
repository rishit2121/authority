"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Icon } from "@/components/ui/Icon";

/** Shown on a connector page only when the user arrived from the Setup page. */
export function BackToSetup() {
  const params = useSearchParams();
  if (params.get("from") !== "setup") return null;
  return (
    <Link
      href="/app/setup"
      className="mb-space-md inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
      data-testid="back-to-setup"
    >
      <Icon name="chevron_left" size={14} />
      Back to setup
    </Link>
  );
}
