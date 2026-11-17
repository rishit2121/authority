import Link from "next/link";

import { InkButton } from "@/components/marketing/InkButton";
import { MobileNav } from "@/components/marketing/MobileNav";
import { CONSOLE_LINK, externalProps, PRIMARY_NAV, SETUP_LINK, SIGN_IN_LINK } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

import { Logo } from "./Logo";

/**
 * A lightweight, read-only session check — just "is someone signed in", not
 * tenant or role — so the marketing header can say "Open console" instead of
 * "Sign in" / "Set up my agent". No tenant/membership lookup, unlike the
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
      <div className="relative mx-auto flex h-[64px] w-full max-w-[1320px] items-center justify-between px-6 md:px-12">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={22} />
          <span className="font-headline-sm text-[15px] font-semibold tracking-tight text-ink">
            Authority
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex lg:gap-10">
          {PRIMARY_NAV.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              {...externalProps(link)}
              className="text-[13px] text-ink-soft transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-6 md:flex">
          {signedIn ? (
            <InkButton href={CONSOLE_LINK.href} className="px-4 py-2 text-[13px]">
              {CONSOLE_LINK.label}
            </InkButton>
          ) : (
            <>
              <Link href={SIGN_IN_LINK.href} className="text-[13px] text-ink-soft hover:text-ink">
                {SIGN_IN_LINK.label}
              </Link>
              <InkButton href={SETUP_LINK.href} className="px-4 py-2 text-[13px]">
                {SETUP_LINK.label}
              </InkButton>
            </>
          )}
        </div>

        <MobileNav links={PRIMARY_NAV} signedIn={signedIn} />
      </div>
    </header>
  );
}
