import Link from "next/link";

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
    <header className="fixed inset-x-0 top-0 z-50 border-b border-mkt-hairline bg-mkt-surface/90 backdrop-blur-md">
      <div className="relative mx-auto flex h-[68px] w-full max-w-[1280px] items-center justify-between px-6 md:px-10">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-headline-sm text-[16px] font-semibold tracking-tight text-mkt-text">
            Authority
          </span>
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {PRIMARY_NAV.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-[14px] text-mkt-text-secondary transition-colors hover:text-mkt-text"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-5 md:flex">
          {signedIn ? (
            <Link
              href="/app"
              className="rounded-md bg-mkt-indigo px-4 py-2 text-[14px] font-medium text-white transition-colors hover:bg-[#3F4CDB]"
            >
              Open console
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-[14px] text-mkt-text-secondary hover:text-mkt-text">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-mkt-indigo px-4 py-2 text-[14px] font-medium text-white transition-colors hover:bg-[#3F4CDB]"
              >
                Start building
              </Link>
            </>
          )}
        </div>

        <MobileNav links={PRIMARY_NAV} signedIn={signedIn} consoleHref="/app" />
      </div>
    </header>
  );
}
