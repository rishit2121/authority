import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/AuthShell";
import { getVerifiedUser } from "@/lib/auth/identity";
import { loadPilotViewer } from "@/lib/pilot/viewer";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invite-only" };
export const dynamic = "force-dynamic";

export default async function InviteOnlyPage() {
  const supabase = await createClient();
  const user = await getVerifiedUser(supabase);
  if (!user) redirect("/login");
  const pilot = await loadPilotViewer(supabase).catch(() => null);
  if (pilot?.access === "eligible") redirect("/app");

  return (
    <AuthShell
      title="Authority is currently invite-only"
      description={
        pilot?.access === "unconfirmed"
          ? "Confirm your email address first, using the link we sent you."
          : "This account isn't approved for the developer pilot yet. Approval is manual; if you've already requested access, we'll reach out if there's a fit."
      }
      footer={
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            className="font-medium text-primary-container underline decoration-primary-container/40 underline-offset-2"
          >
            Sign out
          </button>
        </form>
      }
    >
      <Link
        href="/request-access"
        className="flex h-11 w-full items-center justify-center rounded-lg bg-primary px-space-lg font-headline-sm text-body-md font-medium text-on-primary transition-all hover:bg-primary-fixed"
      >
        Request access
      </Link>
    </AuthShell>
  );
}
