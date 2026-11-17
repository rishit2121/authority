import Link from "next/link";

import { InkButton } from "@/components/marketing/InkButton";
import { InkOutlineButton } from "@/components/marketing/InkOutlineButton";
import { MarketingContainer } from "@/components/marketing/MarketingContainer";
import { Icon } from "@/components/ui/Icon";

/** Closing call to action shared by the home page and /how-it-works. */
export function FinalCta({
  link = { label: "How Authority works", href: "/how-it-works" },
}: {
  /** The quieter text link under the two buttons. */
  link?: { label: string; href: string };
}) {
  return (
    <section id="get-started" aria-labelledby="final-cta-heading" className="py-14 md:py-20">
      <MarketingContainer className="flex flex-col items-start">
        <h2
          id="final-cta-heading"
          className="max-w-2xl font-display-serif text-[clamp(2rem,3.4vw,2.85rem)] font-normal leading-[1.05] tracking-[-0.02em] text-ink"
        >
          Give your agent tools. Set the limits.
        </h2>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <InkButton href="/app/setup">Set up my agent</InkButton>
          <InkOutlineButton href="/docs">Read the docs</InkOutlineButton>
        </div>
        <Link
          href={link.href}
          className="mt-5 inline-flex items-center gap-1 text-[15px] font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
        >
          {link.label}
          <Icon name="arrow_forward" size={16} />
        </Link>
      </MarketingContainer>
    </section>
  );
}
