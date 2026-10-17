import Link from "next/link";

import { MarketingContainer } from "@/components/marketing/MarketingContainer";
import { PrimaryButton } from "@/components/marketing/PrimaryButton";

export function FinalCta() {
  return (
    <section id="get-started" className="py-24 md:py-32">
      <MarketingContainer className="flex flex-col items-center text-center">
        <h2 className="max-w-2xl font-headline-lg text-mkt-h2-mobile text-mkt-text md:text-mkt-h2">
          Give your agents room to work—not room to wander.
        </h2>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
          <PrimaryButton href="/request-access">Request access</PrimaryButton>
          <Link
            href="#security"
            className="text-[15px] font-medium text-mkt-text underline decoration-mkt-hairline underline-offset-4 hover:decoration-mkt-text"
          >
            Read the architecture
          </Link>
        </div>
      </MarketingContainer>
    </section>
  );
}
