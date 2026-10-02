import Link from "next/link";

import { InkButton } from "@/components/marketing/InkButton";
import { MobileNav } from "@/components/marketing/MobileNav";
import { PRIMARY_NAV } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

import { Logo } from "./Logo";

/**
 * A lightweight, read-only session check — just "is someone signed in", not
 * tenant or role — so the marketing header can say "Open console" instead of
 * "Sign in" / "Start building". No tenant/membership lookup, unlike the
 * authenticated app's `createRepositoriesForCurrentTenant`.
 */
async function getIsSignedIn(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

export async function SiteHeader() {
  const signedIn = await getIsSignedIn();

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-paper/95 backdrop-blur-md">
      <div className="relative mx-auto flex h-[64px] w-full max-w-[1320px] items-center justify-between px-8 md:px-12">
        <a href="#top" className="flex items-center gap-2">
          <Logo size={22} />
          <span className="font-headline-sm text-[15px] font-semibold tracking-tight text-ink">
            Authority
          </span>
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-10 md:flex">
          {PRIMARY_NAV.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-[13px] text-ink-soft transition-colors hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-6 md:flex">
          {signedIn ? (
            <InkButton href="/app" className="px-4 py-2 text-[13px]">
              Open console
            </InkButton>
          ) : (
            <>
              <Link href="/login" className="text-[13px] text-ink-soft hover:text-ink">
                Sign in
              </Link>
              <InkButton href="/signup" className="px-4 py-2 text-[13px]">
                Start building
              </InkButton>
            </>
          )}
        </div>

        <MobileNav links={PRIMARY_NAV} signedIn={signedIn} consoleHref="/app" />
      </div>
    </header>
  );
}
